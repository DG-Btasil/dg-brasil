import { precoDe } from '../config.js'
import { ErroExecucao, comoErroExecucao } from '../erros.js'
import {
  usoVazio,
  type AIProvider, type Anexo, type ContextoFerramenta, type PacoteSkill, type ResultadoProvedor,
  type SkillNoProvedor, type TarefaProvedor,
} from './tipos.js'

/**
 * Provedor determinístico para testes. Nenhuma chamada paga, nenhuma rede.
 *
 * Um "roteiro" faz o papel do modelo: chama as ferramentas do catálogo (pelo
 * mesmo caminho do provedor real — a ferramenta recebe a entrada crua e
 * valida), grava arquivos no "ambiente isolado", gasta passos. Com ele se
 * testam sucesso, saída fora do formato, tempo esgotado, limite de uso,
 * falha do provedor e interrupção.
 */

export interface ChamadaSimulada {
  texto: string
  erro: boolean
  anexos: Anexo[]
}

export interface Simulacao {
  readonly tarefa: TarefaProvedor
  /** Chama uma ferramenta como o modelo faria (conta passo e chamada). */
  chamar(nome: string, entrada?: unknown): Promise<ChamadaSimulada>
  /** O agente grava um arquivo em $OUTPUT_DIR do ambiente isolado. */
  gerarArquivo(nome: string, conteudo: string | Uint8Array, mime?: string): void
  /** Um passo de modelo sem ferramenta (gasta tokens). */
  passo(): Promise<void>
  /** Fica "pensando" até ser interrompido ou o tempo acabar. */
  aguardarInterrupcao(): Promise<never>
}

export type Roteiro = (sim: Simulacao) => Promise<void>

export interface OpcoesFalso {
  tokensEntradaPorPasso?: number
  tokensSaidaPorPasso?: number
  /** Quando o domínio lembra o agente de entregar algo: o que o "modelo" faz. */
  aoLembrete?: Roteiro
}

export class ProvedorFalso implements AIProvider {
  readonly id = 'FAKE'
  readonly tarefas: TarefaProvedor[] = []
  readonly skillsEnviadas: PacoteSkill[] = []
  readonly lembretesRecebidos: string[] = []
  private versao = 0

  constructor(private readonly roteiro: Roteiro, private readonly op: OpcoesFalso = {}) {}

  async garantirSkill(p: PacoteSkill): Promise<SkillNoProvedor & { nome: string }> {
    this.skillsEnviadas.push(p)
    this.versao++
    return {
      providerSkillId: p.providerSkillIdExistente ?? `skill_fake_${p.nome}`,
      providerVersionId: `skver_fake_${this.versao}`,
      nome: p.nome,
    }
  }

  async executar(t: TarefaProvedor): Promise<ResultadoProvedor> {
    this.tarefas.push(t)
    const uso = usoVazio()
    const preco = precoDe(t.modelo)
    if (!preco) throw new ErroExecucao('CONFIGURATION_ERROR', `modelo não permitido: ${t.modelo}`)

    const ctrl = new AbortController()
    const prazo = setTimeout(() => ctrl.abort('timeout'), t.limites.maxDuracaoMs)
    const aoInterromper = () => ctrl.abort('cancel')
    if (t.sinal.aborted) ctrl.abort('cancel')
    else t.sinal.addEventListener('abort', aoInterromper, { once: true })

    const gerados = new Map<string, { mime: string; bytes: Uint8Array }>()
    const ctxFerramenta: ContextoFerramenta = {
      arquivosGerados: () => [...gerados.keys()],
      arquivoGerado: async (nome) => {
        const g = gerados.get(nome)
        return g ? { nome, mime: g.mime, bytes: g.bytes } : null
      },
    }
    const porNome = new Map(t.ferramentas.map((f) => [f.nome, f]))
    const confere = () => {
      if (ctrl.signal.aborted) throw new ErroExecucao(ctrl.signal.reason === 'timeout' ? 'EXECUTION_TIMEOUT' : 'CANCELLED')
    }

    const passo = async () => {
      confere()
      if (uso.passos >= t.limites.maxPassos) throw new ErroExecucao('BUDGET_EXCEEDED', 'limite de passos')
      uso.passos++
      const entrada = this.op.tokensEntradaPorPasso ?? 1000
      const saida = this.op.tokensSaidaPorPasso ?? 200
      uso.tokensEntrada += entrada
      uso.tokensSaida += saida
      uso.custoUsd += (entrada * preco.entrada + saida * preco.saida) / 1_000_000
      if (uso.custoUsd > t.limites.maxCustoUsd) throw new ErroExecucao('BUDGET_EXCEEDED', 'teto de custo')
      await t.aoPasso?.(uso)
      confere()
    }

    const sim: Simulacao = {
      tarefa: t,
      passo,
      async chamar(nome, entrada = {}) {
        await passo()
        uso.chamadasFerramenta++
        uso.ferramentas[nome] = (uso.ferramentas[nome] ?? 0) + 1
        if (uso.chamadasFerramenta > t.limites.maxChamadasFerramenta) {
          throw new ErroExecucao('BUDGET_EXCEEDED', 'limite de chamadas de ferramenta')
        }
        const f = porNome.get(nome)
        if (!f) return { texto: `A ferramenta "${nome}" não existe neste ambiente.`, erro: true, anexos: [] }
        try {
          const r = await f.executar(entrada, ctxFerramenta)
          return { texto: r.texto, erro: !!r.erro, anexos: r.anexos ?? [] }
        } catch (e) {
          if (e instanceof ErroExecucao) throw e
          return { texto: 'A ferramenta falhou.', erro: true, anexos: [] }
        }
      },
      gerarArquivo(nome, conteudo, mime = 'text/plain') {
        if (!t.ambienteIsolado.habilitado) throw new Error('ambiente isolado desligado nesta execução')
        gerados.set(nome, { mime, bytes: typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo })
      },
      aguardarInterrupcao: () => new Promise<never>((_, rejeitar) => {
        const falhar = () => rejeitar(new ErroExecucao(ctrl.signal.reason === 'timeout' ? 'EXECUTION_TIMEOUT' : 'CANCELLED'))
        if (ctrl.signal.aborted) falhar()
        else ctrl.signal.addEventListener('abort', falhar, { once: true })
      }),
    }

    try {
      await this.roteiro(sim)
      let lembretes = 0
      for (;;) {
        await passo()
        const lembrete = await t.aoTerminar?.()
        if (!lembrete) break
        this.lembretesRecebidos.push(lembrete)
        // Sem reação ao lembrete, ou lembretes esgotados: saída fora do exigido.
        if (!this.op.aoLembrete || lembretes >= t.limites.maxLembretesFinais) {
          throw new ErroExecucao('INVALID_OUTPUT', 'o agente encerrou sem entregar o que a execução exige')
        }
        lembretes++
        await this.op.aoLembrete(sim)
      }
      return { modelo: t.modelo, uso, textoFinal: 'ok' }
    } catch (e) {
      const erro = comoErroExecucao(e)
      erro.uso = uso
      erro.modelo = t.modelo
      throw erro
    } finally {
      clearTimeout(prazo)
      t.sinal.removeEventListener('abort', aoInterromper)
    }
  }
}

/** Roteiro que falha como o provedor falharia. */
export function falhaDoProvedor(categoria: ConstructorParameters<typeof ErroExecucao>[0]): Roteiro {
  return async (sim) => {
    await sim.passo()
    throw new ErroExecucao(categoria, 'simulado')
  }
}
