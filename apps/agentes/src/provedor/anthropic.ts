import Anthropic, { toFile } from '@anthropic-ai/sdk'
import { precoDe } from '../config.js'
import { ErroExecucao, comoErroExecucao } from '../erros.js'
import { loggerMudo, type Logger } from '../log.js'
import {
  usoVazio,
  type AIProvider, type Anexo, type ArquivoGerado, type ContextoFerramenta, type PacoteSkill,
  type ResultadoFerramenta, type ResultadoProvedor, type SkillNoProvedor, type TarefaProvedor, type Uso,
} from './tipos.js'

/**
 * Provedor real: Claude API (Messages), SDK oficial @anthropic-ai/sdk,
 * autenticação por chave de API do Console (ANTHROPIC_API_KEY). Assinatura
 * Claude/Claude Code NÃO é usada: a Anthropic não permite login de assinatura
 * em produto de terceiros (ver docs/etapa-5-relatorio.md, seção 2).
 *
 * Loop manual (e não o tool runner) porque o domínio precisa intervir entre
 * os passos: conferir interrupção e reserva, contar custo/passos/chamadas e
 * parar no teto, anexar documentos e capturar os arquivos gerados.
 *
 * Ambiente isolado = ferramenta oficial de execução de código: contêiner da
 * Anthropic sem internet e sem instalação de pacote, com as skills da versão
 * (Skills API) carregadas. Os scripts das skills rodam LÁ, nunca no worker:
 * o modelo não alcança o processo, o disco nem as variáveis do worker.
 */

const FERRAMENTA_CODIGO = { type: 'code_execution_20260521', name: 'code_execution' } as const

/** Tipos que o modelo LÊ como documento/imagem (bloco no resultado da ferramenta). */
const LEITURA_DOCUMENTO = new Set(['application/pdf', 'text/plain'])
const LEITURA_IMAGEM = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export interface OpcoesClaude {
  chave?: string
  maxRetries: number
  timeoutMs: number
  logger?: Logger
  /** Para testes: um cliente já construído. */
  cliente?: Anthropic
}

export class ClaudeApiProvider implements AIProvider {
  readonly id = 'ANTHROPIC'
  private readonly cliente: Anthropic
  private readonly log: Logger

  constructor(op: OpcoesClaude) {
    if (!op.cliente && !op.chave) {
      throw new ErroExecucao('CONFIGURATION_ERROR', 'ANTHROPIC_API_KEY ausente')
    }
    // O SDK já repete 408/409/429/5xx e falha de rede com espera crescente
    // (maxRetries). Esgotado isso, o worker devolve a execução à fila.
    this.cliente = op.cliente ?? new Anthropic({ apiKey: op.chave, maxRetries: op.maxRetries, timeout: op.timeoutMs })
    this.log = op.logger ?? loggerMudo
  }

  async garantirSkill(p: PacoteSkill): Promise<SkillNoProvedor & { nome: string }> {
    try {
      if (p.providerSkillIdExistente) {
        try {
          const v = await this.cliente.skills.versions.create(p.providerSkillIdExistente, { files: await arquivosSkill(p) })
          return { providerSkillId: p.providerSkillIdExistente, providerVersionId: v.id, nome: p.nome }
        } catch (e) {
          // Skill apagada no provedor, ou nome divergente: cria outra.
          if (!(e instanceof Anthropic.NotFoundError || e instanceof Anthropic.BadRequestError)) throw e
        }
      }
      const s = await this.cliente.skills.create({ files: await arquivosSkill(p), display_name: p.nome })
      return { providerSkillId: s.id, providerVersionId: s.latest_version_id, nome: p.nome }
    } catch (e) {
      throw traduzirErro(e)
    }
  }

  async executar(t: TarefaProvedor): Promise<ResultadoProvedor> {
    const uso = usoVazio()
    const preco = precoDe(t.modelo)
    if (!preco) throw new ErroExecucao('CONFIGURATION_ERROR', `modelo não permitido: ${t.modelo}`)

    const porNome = new Map(t.ferramentas.map((f) => [f.nome, f]))
    const definicoes: Anthropic.Messages.ToolUnion[] = t.ferramentas.map((f) => ({
      name: f.nome,
      description: f.descricao,
      input_schema: f.esquema as Anthropic.Tool.InputSchema,
      ...(f.estrita ? { strict: true } : {}),
    }))
    if (t.ambienteIsolado.habilitado) definicoes.push(FERRAMENTA_CODIGO)

    // Interrupção externa e tempo máximo abortam o MESMO controlador; o
    // motivo distingue CANCELLED de EXECUTION_TIMEOUT.
    const ctrl = new AbortController()
    const prazo = setTimeout(() => ctrl.abort('timeout'), t.limites.maxDuracaoMs)
    const aoInterromper = () => ctrl.abort('cancel')
    if (t.sinal.aborted) ctrl.abort('cancel')
    else t.sinal.addEventListener('abort', aoInterromper, { once: true })

    const enviados: string[] = []
    const gerados = new Map<string, { id: string; mime: string }>()
    const ctxFerramenta: ContextoFerramenta = {
      arquivosGerados: () => [...gerados.keys()],
      arquivoGerado: async (nome) => {
        const g = gerados.get(nome)
        if (!g) return null
        const r = await this.cliente.files.download(g.id, undefined, { signal: ctrl.signal })
        return { nome, mime: g.mime, bytes: new Uint8Array(await r.arrayBuffer()) } satisfies ArquivoGerado
      },
    }

    const mensagens: Anthropic.MessageParam[] = [{ role: 'user', content: t.pedido }]
    let containerId: string | undefined
    let lembretes = 0

    try {
      for (;;) {
        if (ctrl.signal.aborted) throw abortado(ctrl.signal)
        if (uso.passos >= t.limites.maxPassos) throw new ErroExecucao('BUDGET_EXCEEDED', 'limite de passos')

        let msg: Anthropic.Message
        try {
          msg = await this.cliente.messages.stream({
            model: t.modelo,
            max_tokens: t.limites.maxTokensSaida,
            // Instruções estáveis primeiro, com cache: o mesmo prefixo nos passos seguintes.
            system: [{ type: 'text', text: t.sistema, cache_control: { type: 'ephemeral' } }],
            messages: mensagens,
            tools: definicoes,
            thinking: { type: 'adaptive' },
            output_config: { effort: t.esforco },
            ...(t.ambienteIsolado.habilitado ? {
              container: {
                ...(containerId ? { id: containerId } : {}),
                skills: t.ambienteIsolado.skills.map((s) => ({
                  type: 'custom' as const, skill_id: s.providerSkillId, version: s.providerVersionId,
                })),
              },
            } : {}),
          }, { signal: ctrl.signal }).finalMessage()
        } catch (e) {
          throw traduzirErro(e, ctrl.signal)
        }

        uso.passos++
        somarUso(uso, msg, preco)
        if (msg.container?.id) containerId = msg.container.id
        await this.registrarGerados(msg, gerados, ctrl.signal)
        mensagens.push({ role: 'assistant', content: msg.content as Anthropic.ContentBlockParam[] })

        if (uso.custoUsd > t.limites.maxCustoUsd) throw new ErroExecucao('BUDGET_EXCEEDED', 'teto de custo')
        await t.aoPasso?.(uso)
        if (ctrl.signal.aborted) throw abortado(ctrl.signal)

        if (msg.stop_reason === 'refusal') throw new ErroExecucao('PROVIDER_REFUSED', msg.stop_details?.category ?? undefined)
        // Turno longo do ambiente isolado: reenviar como está continua de onde parou.
        if (msg.stop_reason === 'pause_turn') continue
        if (msg.stop_reason === 'max_tokens' || msg.stop_reason === 'model_context_window_exceeded') {
          throw new ErroExecucao('INVALID_OUTPUT', 'resposta cortada pelo limite de tamanho')
        }

        const chamadas = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        if (chamadas.length === 0) {
          const lembrete = await t.aoTerminar?.()
          if (!lembrete) return { modelo: msg.model || t.modelo, uso, textoFinal: textoDe(msg) }
          if (lembretes >= t.limites.maxLembretesFinais) {
            throw new ErroExecucao('INVALID_OUTPUT', 'o agente encerrou sem entregar o que a execução exige')
          }
          lembretes++
          mensagens.push({ role: 'user', content: lembrete })
          continue
        }

        const resultados: Anthropic.ToolResultBlockParam[] = []
        const paraOAmbiente: Anthropic.ContainerUploadBlockParam[] = []
        for (const c of chamadas) {
          if (ctrl.signal.aborted) throw abortado(ctrl.signal)
          uso.chamadasFerramenta++
          uso.ferramentas[c.name] = (uso.ferramentas[c.name] ?? 0) + 1
          if (uso.chamadasFerramenta > t.limites.maxChamadasFerramenta) {
            throw new ErroExecucao('BUDGET_EXCEEDED', 'limite de chamadas de ferramenta')
          }

          const f = porNome.get(c.name)
          let r: ResultadoFerramenta
          if (!f) {
            // O modelo só alcança o catálogo: nome fora dele não executa nada.
            r = { texto: `A ferramenta "${c.name}" não existe neste ambiente.`, erro: true }
          } else {
            try {
              r = await f.executar(c.input, ctxFerramenta)
            } catch (e) {
              if (e instanceof ErroExecucao) throw e
              this.log.warn('ferramenta_falhou', { tool: c.name })
              r = { texto: 'A ferramenta falhou. Tente de outro jeito ou encerre explicando o que faltou.', erro: true }
            }
          }

          const conteudo: Exclude<Anthropic.ToolResultBlockParam['content'], string | undefined> =
            [{ type: 'text', text: r.texto }]
          for (const a of r.anexos ?? []) {
            const id = await this.enviarArquivo(a, ctrl.signal)
            enviados.push(id)
            if (a.modo !== 'arquivo') {
              if (LEITURA_DOCUMENTO.has(mimeEnvio(a))) {
                conteudo.push({ type: 'document', source: { type: 'file', file_id: id }, title: a.nome.slice(0, 200) })
              } else if (LEITURA_IMAGEM.has(a.mime)) {
                conteudo.push({ type: 'image', source: { type: 'file', file_id: id } })
              }
            }
            if (a.modo !== 'leitura' && t.ambienteIsolado.habilitado) {
              paraOAmbiente.push({ type: 'container_upload', file_id: id })
            }
          }
          resultados.push({ type: 'tool_result', tool_use_id: c.id, content: conteudo, ...(r.erro ? { is_error: true } : {}) })
        }
        mensagens.push({ role: 'user', content: [...resultados, ...paraOAmbiente] })
      }
    } catch (e) {
      const erro = comoErroExecucao(e)
      erro.uso = uso
      erro.modelo = t.modelo
      throw erro
    } finally {
      clearTimeout(prazo)
      t.sinal.removeEventListener('abort', aoInterromper)
      // Nada do caso fica na Files API além da execução (o contêiner ainda
      // retém por até 30 dias, pela política do provedor — ver relatório).
      await this.apagar([...enviados, ...[...gerados.values()].map((g) => g.id)])
    }
  }

  private async enviarArquivo(a: Anexo, sinal: AbortSignal): Promise<string> {
    try {
      const f = await this.cliente.files.upload(
        { file: await toFile(Buffer.from(a.bytes), a.nome, { type: mimeEnvio(a) }) },
        { signal: sinal },
      )
      return f.id
    } catch (e) {
      throw traduzirErro(e, sinal)
    }
  }

  /** Arquivos que o agente gravou em $OUTPUT_DIR voltam como file_id nos resultados de bash. */
  private async registrarGerados(msg: Anthropic.Message, gerados: Map<string, { id: string; mime: string }>, sinal: AbortSignal) {
    for (const b of msg.content) {
      if (b.type !== 'bash_code_execution_tool_result' || b.content.type !== 'bash_code_execution_result') continue
      for (const saida of b.content.content) {
        try {
          const m = await this.cliente.files.retrieveMetadata(saida.file_id, undefined, { signal: sinal })
          gerados.set(m.filename, { id: saida.file_id, mime: m.mime_type })
        } catch (e) {
          throw traduzirErro(e, sinal)
        }
      }
    }
  }

  private async apagar(ids: string[]) {
    for (const id of new Set(ids)) {
      try {
        await this.cliente.files.delete(id)
      } catch {
        this.log.warn('arquivo_provedor_nao_apagado', { count: 1 })
      }
    }
  }
}

/** SKILL.md gerado a partir da versão: frontmatter do provedor + instruções. */
export function skillMd(p: PacoteSkill): string {
  const descricao = (p.descricao || p.nome).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1024)
  return `---\nname: ${p.nome}\ndescription: ${JSON.stringify(descricao)}\n---\n\n${p.instrucoes.trim()}\n`
}

async function arquivosSkill(p: PacoteSkill) {
  return Promise.all([
    toFile(Buffer.from(skillMd(p), 'utf8'), `${p.nome}/SKILL.md`, { type: 'text/markdown' }),
    ...p.arquivos.map((a) => toFile(Buffer.from(a.bytes), `${p.nome}/${a.caminho}`, { type: a.mime })),
  ])
}

/** Texto (markdown, csv, json) vai como text/plain: é o que o bloco de documento lê. */
function mimeEnvio(a: Anexo): string {
  if (a.mime.startsWith('text/') || a.mime === 'application/json') return 'text/plain'
  return a.mime
}

function somarUso(uso: Uso, msg: Anthropic.Message, preco: NonNullable<ReturnType<typeof precoDe>>) {
  const u = msg.usage
  const leitura = u.cache_read_input_tokens ?? 0
  const escrita = u.cache_creation_input_tokens ?? 0
  uso.tokensEntrada += u.input_tokens
  uso.tokensSaida += u.output_tokens
  uso.cacheLeitura += leitura
  uso.cacheEscrita += escrita
  // Estimativa por tokens (tabela pública). Não inclui horas de contêiner
  // do ambiente isolado (cobradas à parte pelo provedor).
  uso.custoUsd += (u.input_tokens * preco.entrada + u.output_tokens * preco.saida
    + leitura * preco.cacheLeitura + escrita * preco.cacheEscrita) / 1_000_000
  for (const b of msg.content) {
    if (b.type === 'server_tool_use' && (b.name === 'bash_code_execution' || b.name === 'text_editor_code_execution')) {
      uso.execucoesCodigo++
    }
  }
}

function textoDe(msg: Anthropic.Message): string {
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').slice(0, 2000)
}

function abortado(sinal: AbortSignal): ErroExecucao {
  return sinal.reason === 'timeout'
    ? new ErroExecucao('EXECUTION_TIMEOUT')
    : new ErroExecucao('CANCELLED')
}

/**
 * Erro do SDK → categoria. Nunca repassa a mensagem do provedor (pode trazer
 * trecho do pedido): só o status HTTP e o tipo.
 */
export function traduzirErro(e: unknown, sinal?: AbortSignal): ErroExecucao {
  if (e instanceof ErroExecucao) return e
  if (sinal?.aborted || e instanceof Anthropic.APIUserAbortError) {
    return sinal ? abortado(sinal) : new ErroExecucao('CANCELLED')
  }
  if (e instanceof Anthropic.RateLimitError) return new ErroExecucao('PROVIDER_RATE_LIMITED', 'HTTP 429')
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ErroExecucao('CONFIGURATION_ERROR', `credencial do provedor recusada (HTTP ${e.status})`)
  }
  if (e instanceof Anthropic.NotFoundError) return new ErroExecucao('CONFIGURATION_ERROR', 'modelo, skill ou arquivo não encontrado no provedor (HTTP 404)')
  if (e instanceof Anthropic.BadRequestError) return new ErroExecucao('CONFIGURATION_ERROR', 'pedido recusado pelo provedor (HTTP 400)')
  if (e instanceof Anthropic.APIConnectionError) return new ErroExecucao('PROVIDER_UNAVAILABLE', 'sem conexão com o provedor')
  if (e instanceof Anthropic.InternalServerError) return new ErroExecucao('PROVIDER_UNAVAILABLE', `HTTP ${e.status}`)
  if (e instanceof Anthropic.APIError) {
    return typeof e.status === 'number' && e.status >= 500
      ? new ErroExecucao('PROVIDER_UNAVAILABLE', `HTTP ${e.status}`)
      : new ErroExecucao('CONFIGURATION_ERROR', `HTTP ${e.status ?? '?'}`)
  }
  return comoErroExecucao(e)
}
