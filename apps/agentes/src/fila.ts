import { LIMITES_PADRAO } from './config.js'
import type { Armazenamento } from './armazenamento.js'
import { um, type Banco } from './banco.js'
import { carregarAgente, prepararSkills } from './carregar.js'
import { ErroExecucao, comoErroExecucao, type UsoParcial } from './erros.js'
import { criarFerramentas, paraProvedor } from './ferramentas.js'
import { loggerMudo, type Logger } from './log.js'
import { ORCAMENTO_INSTRUCOES, VERSAO_PROMPT, comporPrompt } from './prompt.js'
import type { AIProvider, LimitesTarefa, Uso } from './provedor/tipos.js'
import {
  MensagemFila,
  type AgenteCarregado, type AgentRun, type AnaliseDaExecucao, type ContextoExecucao, type EntradaExecucao, type Registro,
} from './tipos.js'

/**
 * Consumo da fila agent_execution (pgmq), como dg_worker.
 *
 * O worker não lê tabela de domínio: tudo passa por funções private.worker_*,
 * que exigem a reserva DESTA execução e derivam caso/cliente dela. Execução do
 * caso A não tem caminho para dados do caso B.
 *
 *   pgmq.read        a mensagem fica invisível por VT segundos;
 *   claim            private.claim_agent_run reserva a execução atomicamente
 *                    (UPDATE ... WHERE status = 'QUEUED'): dois workers com a
 *                    mesma execução, só um ganha. Reserva de worker morto
 *                    (batimento parado) é retomada;
 *   heartbeat        enquanto o agente roda, private.heartbeat_agent_run bate e
 *                    estende o VT — execução longa não reaparece na fila nem
 *                    roda em dobro. Reserva perdida: o provedor é abortado e
 *                    nada mais é gravado (o banco recusa: claimed_by não confere);
 *   interromper      (033) antes de começar, a cada batimento, a cada passo do
 *                    agente e antes de encerrar: com pedido de interrupção, o
 *                    provedor é abortado, nenhuma entrega nova acontece e a
 *                    execução termina CANCELLED (não conclui);
 *   encerrar         private.worker_finish_run + pgmq.archive.
 *
 * Falha transitória (rede, limite do provedor, provedor fora) volta à fila
 * com espera crescente; permanente (configuração, saída inválida, tempo,
 * teto) falha de vez. Tentativa que já entregou algo nunca é refeita:
 * duplicaria o que está em Revisões (PARTIAL_OUTPUT).
 */

export const FILA = 'agent_execution'
export const VERSAO_RUNTIME = 'dg-agentes/5.0'

export interface Dependencias {
  banco: Banco
  armazenamento: Armazenamento
  provedor: AIProvider
  worker: string
  maxTentativas: number
  /** Segundos de invisibilidade da mensagem; o batimento a renova. */
  vtSegundos: number
  /** Intervalo entre batimentos, em ms. Padrão: um terço do VT. */
  batimentoMs?: number
  /** Batimento parado há mais que isto = worker morto; a reserva pode ser retomada. */
  reservaVencidaSegundos?: number
  /** Teto de custo por execução quando a versão do agente não define. */
  tetoUsd?: number
  /** Aperta limites da tarefa por cima da configuração do agente (testes, operação de emergência). */
  limites?: Partial<LimitesTarefa>
  log?: Logger
}

export interface MensagemLida {
  msg_id: string
  read_ct: number
  message: unknown
}

export type Desfecho =
  | 'concluida' | 'aguardando_humano' | 'falhou' | 'reenfileirada' | 'ignorada' | 'reservada_por_outro' | 'interrompida'

/** O que private.worker_run_context devolve. */
interface ContextoBanco {
  id: string
  agent_id: string
  agent_version_id: string
  legal_case_id: string | null
  legal_process_id: string | null
  client_id: string | null
  requested_by: string | null
  attempt: number
  retry_of_agent_run_id: string | null
  previous_output: boolean
  input: { request_text: string | null; parameters: Record<string, unknown> }
  analysis: AnaliseDaExecucao | null
}

export async function lerMensagem(banco: Banco, vtSegundos: number): Promise<MensagemLida | null> {
  const m = await um<{ msg_id: string | number; read_ct: number; message: unknown }>(
    banco,
    `select msg_id, read_ct, message from pgmq.read($1::text, $2::int, 1)`,
    [FILA, vtSegundos],
  )
  return m ? { msg_id: String(m.msg_id), read_ct: Number(m.read_ct), message: m.message } : null
}

/** Interruptor geral (039): com a IA desligada pelo ADMIN, o worker não lê a fila. */
export async function iaHabilitadaNoBanco(banco: Banco): Promise<boolean> {
  const r = await um<{ v: boolean }>(banco, `select private.worker_ai_enabled() as v`)
  return r?.v === true
}

const arquivar = (banco: Banco, msgId: string) =>
  banco.query(`select pgmq.archive($1::text, $2::bigint)`, [FILA, msgId])

const TERMINAIS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_HUMAN'])

export async function processarMensagem(deps: Dependencias, msg: MensagemLida): Promise<Desfecho> {
  const { banco, worker } = deps
  const log = deps.log ?? loggerMudo

  const conteudo = MensagemFila.safeParse(msg.message)
  if (!conteudo.success) {
    // Mensagem fora do contrato não tem como dar certo numa nova tentativa.
    await arquivar(banco, msg.msg_id)
    return 'ignorada'
  }
  const runId = conteudo.data.agent_run_id

  // Reserva atômica. Sem reserva: execução inexistente ou terminada → arquiva;
  // outro worker vivo com ela (o batimento dele mantém a mensagem invisível) →
  // não arquiva, não executa.
  const reserva = (await um<{ claimed: boolean; status: string | null }>(banco,
    `select claimed, status from private.claim_agent_run($1::uuid, $2::text, $3::bigint, $4::int)`,
    [runId, worker, msg.msg_id, deps.reservaVencidaSegundos ?? Math.max(60, deps.vtSegundos)]))!
  if (!reserva.claimed) {
    if (reserva.status === null || TERMINAIS.has(reserva.status)) {
      await arquivar(banco, msg.msg_id)
      return 'ignorada'
    }
    return 'reservada_por_outro'
  }

  const contexto = (await um<{ c: ContextoBanco }>(banco,
    `select private.worker_run_context($1::uuid, $2::text) as c`, [runId, worker]))!.c
  const run: AgentRun = {
    id: contexto.id, agent_id: contexto.agent_id, agent_version_id: contexto.agent_version_id,
    legal_case_id: contexto.legal_case_id, legal_process_id: contexto.legal_process_id,
    requested_by: contexto.requested_by, attempt: contexto.attempt,
    retry_of_agent_run_id: contexto.retry_of_agent_run_id,
  }
  const campos = { agent_run_id: run.id, msg_id: msg.msg_id, attempt: run.attempt }

  // Tentativa anterior que já deixou proposta, minuta ou resultado não é
  // refeita: rodar de novo duplicaria o que está em Revisões.
  if (contexto.previous_output) {
    await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
      error_code: 'PARTIAL_OUTPUT',
      error_message: 'Uma tentativa anterior foi interrompida depois de entregar parte do resultado. ' +
        'Confira em Revisões e dispare de novo se precisar.',
    })
    return 'falhou'
  }

  if (msg.read_ct > deps.maxTentativas) {
    await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
      error_code: 'MAX_ATTEMPTS',
      error_message: `Excedeu ${deps.maxTentativas} tentativas.`,
    })
    return 'falhou'
  }

  // Pedido de interrupção antes de começar: nem carrega o agente nem chama o provedor.
  if (await interrupcaoPedida(banco, run.id, worker)) {
    return encerrarInterrompida(deps, run.id, msg.msg_id)
  }

  const registro: Registro = {
    propostas: [], documentos: [], analise: null, documentosAbertos: 0,
    tesesConsultadas: new Map(), referenciasAbertas: new Map(), entregues: new Map(),
  }
  const entrada: EntradaExecucao = { pedido: contexto.input.request_text, parametros: contexto.input.parameters }
  const inicio = Date.now()

  // Batimento enquanto o agente roda; a cada batida, confere interrupção e reserva.
  let reservaPerdida = false
  const interromper = new AbortController()
  const conferir = async () => {
    const r = await um<{ ok: boolean }>(banco,
      `select private.heartbeat_agent_run($1::uuid, $2::text, $3::bigint, $4::int) as ok`,
      [run.id, worker, msg.msg_id, deps.vtSegundos])
    if (!r?.ok) {
      reservaPerdida = true
      interromper.abort()
    } else if (await interrupcaoPedida(banco, run.id, worker)) {
      interromper.abort()
    }
  }
  const batimento = setInterval(() => {
    conferir().catch(() => { /* rede instável: a próxima batida tenta de novo */ })
  }, deps.batimentoMs ?? Math.max(5_000, (deps.vtSegundos * 1000) / 3))

  let agente: AgenteCarregado | null = null
  let modelo: string | undefined
  try {
    agente = await carregarAgente(banco, run, contexto.analysis?.template_skill_ids ?? [])
    modelo = agente.config.model
    const ctx: ContextoExecucao = {
      banco, armazenamento: deps.armazenamento, worker, run, agente,
      clienteDoCaso: contexto.client_id, entrada, analise: contexto.analysis,
      operacao: conteudo.data.operation, registro, ambienteIsolado: agente.config.code_execution, log,
    }

    const skills = ctx.ambienteIsolado ? await prepararSkills({ ...deps }, run.id, agente.skills) : []
    const ferramentas = criarFerramentas(ctx).map(paraProvedor)
    const prompt = comporPrompt(ctx, ferramentas)
    if (prompt.tokensInstrucoes > ORCAMENTO_INSTRUCOES) {
      throw new ErroExecucao('CONFIGURATION_ERROR', 'instruções do agente e das skills passam do orçamento de contexto')
    }

    const limites = {
      maxPassos: agente.config.max_turns ?? LIMITES_PADRAO.maxPassos,
      maxChamadasFerramenta: agente.config.max_tool_calls ?? LIMITES_PADRAO.maxChamadasFerramenta,
      maxDuracaoMs: (agente.config.max_duration_seconds ?? LIMITES_PADRAO.maxDuracaoSegundos) * 1000,
      maxCustoUsd: agente.config.max_budget_usd ?? deps.tetoUsd ?? LIMITES_PADRAO.maxCustoUsd,
      maxTokensSaida: agente.config.max_output_tokens ?? LIMITES_PADRAO.maxTokensSaida,
      maxLembretesFinais: LIMITES_PADRAO.maxLembretesFinais,
      ...deps.limites,
    }

    // "Qual configuração produziu isto?": versões, hashes e limites — nunca
    // o texto das instruções, a entrada nem segredo.
    await banco.query(`select private.worker_record_run_config($1::uuid, $2::text, $3::jsonb)`, [run.id, worker, JSON.stringify({
      runtime: VERSAO_RUNTIME,
      provider: deps.provedor.id,
      model: agente.config.model,
      effort: agente.config.effort,
      agent_version_id: agente.versionId,
      skills: agente.skills.map((s) => ({
        skill_id: s.id, version_id: s.versionId, version_number: s.versionNumber, origin: s.origem,
        files: s.arquivos.length, provider_version_id: s.noProvedor?.providerVersionId ?? null,
      })),
      sandbox: ctx.ambienteIsolado,
      prompt_template: VERSAO_PROMPT,
      prompt_sha256: prompt.sha256,
      instruction_tokens_estimate: prompt.tokensInstrucoes,
      tools: ferramentas.map((f) => f.nome),
      limits: limites,
      analysis_id: contexto.analysis?.id ?? null,
    })])

    log.info('execucao_iniciada', { ...campos, agent: agente.slug, agent_version_id: agente.versionId,
      provider: deps.provedor.id, model: agente.config.model, skills: skills.length })

    const resultado = await deps.provedor.executar({
      modelo: agente.config.model,
      esforco: agente.config.effort,
      sistema: prompt.sistema,
      pedido: prompt.pedido,
      ferramentas,
      ambienteIsolado: { habilitado: ctx.ambienteIsolado, skills },
      limites,
      sinal: interromper.signal,
      aoPasso: async () => {
        // Passo longo pode terminar entre batidas: confere já (sem esperar o intervalo).
        await conferir()
        if (reservaPerdida || interromper.signal.aborted) throw new ErroExecucao('CANCELLED')
      },
      aoTerminar: async () => (ctx.analise && !registro.analise)
        ? 'Você ainda não entregou o resultado desta análise. Chame entregar_analise com o resultado ' +
          'estruturado (ou, se faltar informação essencial, entregue mesmo assim registrando o que falta).'
        : null,
    })

    if (reservaPerdida) return 'reservada_por_outro'
    // Pedido que chegou entre a última batida e o fim: o resultado não conclui.
    if (interromper.signal.aborted || await interrupcaoPedida(banco, run.id, worker)) {
      return encerrarInterrompida(deps, run.id, msg.msg_id, resultado.uso, resultado.modelo, registro, inicio)
    }

    const entregou = registro.propostas.length > 0 || registro.documentos.length > 0 || registro.analise !== null
    const destino = entregou ? 'WAITING_HUMAN' : 'COMPLETED'
    await encerrar(deps, run.id, msg.msg_id, destino, {}, resultado.uso, resultado.modelo, registro, inicio)
    log.info('execucao_encerrada', { ...campos, status: destino, ...resumoUso(resultado.uso), duration_ms: Date.now() - inicio })
    return destino === 'WAITING_HUMAN' ? 'aguardando_humano' : 'concluida'
  } catch (bruto) {
    if (reservaPerdida) return 'reservada_por_outro'
    const e = comoErroExecucao(bruto)
    const uso = e.uso
    const modeloUsado = e.modelo ?? modelo
    if (e.categoria === 'CANCELLED' || interromper.signal.aborted || await interrupcaoPedida(banco, run.id, worker)) {
      return encerrarInterrompida(deps, run.id, msg.msg_id, uso, modeloUsado, registro, inicio)
    }
    const entregou = registro.propostas.length > 0 || registro.documentos.length > 0 || registro.analise !== null
    log.warn('execucao_falhou', { ...campos, error_category: e.categoria, duration_ms: Date.now() - inicio, ...resumoUso(uso) })

    if (!e.transitorio || entregou || msg.read_ct >= deps.maxTentativas) {
      await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
        error_code: entregou ? 'PARTIAL_OUTPUT' : e.categoria,
        error_message: entregou ? `Falhou depois de entregar parte do resultado: ${e.message}` : e.message,
      }, uso, modeloUsado, registro, inicio)
      return 'falhou'
    }

    // Transitório: volta para a fila com espera crescente (limite do provedor espera mais).
    const espera = (e.categoria === 'PROVIDER_RATE_LIMITED' ? 60 : 30) * msg.read_ct
    await banco.query(`select private.worker_requeue_run($1::uuid, $2::text, $3::text)`, [run.id, worker, e.message])
    await banco.query(`select pgmq.set_vt($1::text, $2::bigint, $3::int)`, [FILA, msg.msg_id, espera])
    log.info('execucao_reenfileirada', { ...campos, error_category: e.categoria, retry_in_s: espera })
    return 'reenfileirada'
  } finally {
    clearInterval(batimento)
  }
}

/**
 * Contrato da 033: true = pare (interrupção pedida por um humano, ou a
 * execução não está mais reservada por este worker).
 */
async function interrupcaoPedida(banco: Banco, runId: string, worker: string): Promise<boolean> {
  const r = await um<{ v: boolean }>(banco, `select private.worker_cancel_requested($1::uuid, $2::text) as v`, [runId, worker])
  return r?.v === true
}

/**
 * Confirma a interrupção (CANCELLED). O banco só aceita com pedido registrado e
 * reserva deste worker: se recusar, a reserva já era de outro.
 */
async function encerrarInterrompida(
  deps: Dependencias, runId: string, msgId: string, uso?: UsoParcial, modelo?: string, registro?: Registro, inicio?: number,
): Promise<Desfecho> {
  try {
    await encerrar(deps, runId, msgId, 'CANCELLED', { error_code: 'CANCELLED' }, uso, modelo, registro, inicio)
    return 'interrompida'
  } catch {
    return 'reservada_por_outro'
  }
}

function resumoUso(uso?: UsoParcial) {
  if (!uso) return {}
  return {
    input_tokens: uso.tokensEntrada, output_tokens: uso.tokensSaida, cache_read_tokens: uso.cacheLeitura,
    cache_write_tokens: uso.cacheEscrita, estimated_cost_usd: Number(uso.custoUsd.toFixed(6)),
    steps: uso.passos, tool_calls: uso.chamadasFerramenta,
  }
}

/** Status final, só por quem tem a reserva; arquiva a mensagem. */
async function encerrar(
  deps: Dependencias,
  runId: string,
  msgId: string,
  status: 'COMPLETED' | 'WAITING_HUMAN' | 'FAILED' | 'CANCELLED',
  erro: { error_code?: string; error_message?: string },
  uso?: UsoParcial,
  modelo?: string,
  registro?: Registro,
  inicio?: number,
) {
  // Só ids, nomes de ferramenta e contagens vão para metadata. Nunca conteúdo.
  const u = uso as Partial<Uso> | undefined
  const resumo = (registro || uso) ? {
    ...(u?.ferramentas ? { tools_used: u.ferramentas } : {}),
    ...(registro ? {
      proposals: registro.propostas,
      analysis_result_id: registro.analise,
      consulted: {
        theses: [...registro.tesesConsultadas].map(([id, version_id]) => ({ id, version_id })),
        references: [...registro.referenciasAbertas].map(([id, version_id]) => ({ id, version_id })),
        documents_opened: registro.documentosAbertos,
      },
    } : {}),
    ...(uso ? {
      usage: {
        cache_read_tokens: uso.cacheLeitura, cache_write_tokens: uso.cacheEscrita,
        steps: uso.passos, tool_calls: uso.chamadasFerramenta, code_executions: u?.execucoesCodigo ?? 0,
        duration_ms: inicio ? Date.now() - inicio : null,
        cost_basis: 'tokens (tabela pública); sem horas de contêiner',
      },
    } : {}),
  } : null
  await deps.banco.query(
    `select private.worker_finish_run($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
                                      $7::bigint, $8::bigint, $9::numeric, $10::jsonb)`,
    [
      runId, deps.worker, status, erro.error_code ?? null, erro.error_message?.slice(0, 2000) ?? null,
      modelo ?? null, uso?.tokensEntrada ?? null, uso?.tokensSaida ?? null,
      uso ? Number(uso.custoUsd.toFixed(6)) : null, resumo ? JSON.stringify(resumo) : null,
    ],
  )
  await arquivar(deps.banco, msgId)
}
