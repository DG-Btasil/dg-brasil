import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Armazenamento } from './armazenamento.js'
import { um, type Banco } from './banco.js'
import { criarFerramentas } from './ferramentas.js'
import {
  ConfigAgente, MensagemFila,
  type AgenteCarregado, type AgentRun, type EntradaExecucao, type ExecutarAgente, type Metricas, type Registro,
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
 *                    roda em dobro. Se a reserva for perdida, o resultado não é
 *                    gravado (o banco recusa: claimed_by não confere);
 *   encerrar         private.worker_finish_run + pgmq.archive.
 */

export const FILA = 'agent_execution'

export interface Dependencias {
  banco: Banco
  armazenamento: Armazenamento
  executar: ExecutarAgente
  worker: string
  maxTentativas: number
  /** Segundos de invisibilidade da mensagem; o batimento a renova. */
  vtSegundos: number
  /** Intervalo entre batimentos, em ms. Padrão: um terço do VT. */
  batimentoMs?: number
  /** Batimento parado há mais que isto = worker morto; a reserva pode ser retomada. */
  reservaVencidaSegundos?: number
}

export interface MensagemLida {
  msg_id: string
  read_ct: number
  message: unknown
}

export type Desfecho =
  | 'concluida' | 'aguardando_humano' | 'falhou' | 'reenfileirada' | 'ignorada' | 'reservada_por_outro'

/** O que private.worker_run_context devolve. */
interface ContextoBanco {
  id: string
  agent_id: string
  agent_version_id: string
  legal_case_id: string | null
  legal_process_id: string | null
  client_id: string | null
  requested_by: string | null
  previous_output: boolean
  input: { request_text: string | null; parameters: Record<string, unknown> }
}

export async function lerMensagem(banco: Banco, vtSegundos: number): Promise<MensagemLida | null> {
  const m = await um<{ msg_id: string | number; read_ct: number; message: unknown }>(
    banco,
    `select msg_id, read_ct, message from pgmq.read($1::text, $2::int, 1)`,
    [FILA, vtSegundos],
  )
  return m ? { msg_id: String(m.msg_id), read_ct: Number(m.read_ct), message: m.message } : null
}

const arquivar = (banco: Banco, msgId: string) =>
  banco.query(`select pgmq.archive($1::text, $2::bigint)`, [FILA, msgId])

const TERMINAIS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING_HUMAN'])

export async function processarMensagem(deps: Dependencias, msg: MensagemLida): Promise<Desfecho> {
  const { banco, worker } = deps

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
    requested_by: contexto.requested_by,
  }

  // Tentativa anterior que já deixou proposta ou minuta não é refeita: rodar de
  // novo duplicaria o que está em Revisões. Fica para um humano decidir.
  if (contexto.previous_output) {
    await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
      error_code: 'PARTIAL_OUTPUT',
      error_message: 'Uma tentativa anterior foi interrompida depois de gerar propostas ou minutas. ' +
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

  let agente: AgenteCarregado
  try {
    agente = await carregarAgente(banco, run)
  } catch (e) {
    // Agente inativo ou configuração inválida: outra tentativa não muda nada.
    await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
      error_code: (e as { codigo?: string }).codigo ?? 'AGENT_LOAD_ERROR',
      error_message: mensagemDe(e),
    })
    return 'falhou'
  }

  // Pedido em texto e parâmetros: vêm de agent_run_inputs, nunca de metadata.
  const entrada: EntradaExecucao = { pedido: contexto.input.request_text, parametros: contexto.input.parameters }
  const registro: Registro = { ferramentas: {}, negadas: [], propostas: [], documentos: [] }
  const scratch = await mkdtemp(join(tmpdir(), `dgbrasil-${agente.slug}-`))

  // Batimento enquanto o agente roda.
  let reservaPerdida = false
  const batimento = setInterval(() => {
    banco.query(`select private.heartbeat_agent_run($1::uuid, $2::text, $3::bigint, $4::int) as ok`,
      [run.id, worker, msg.msg_id, deps.vtSegundos])
      .then((r) => { if (!(r.rows[0] as { ok?: boolean } | undefined)?.ok) reservaPerdida = true })
      .catch(() => { /* rede instável: a próxima batida tenta de novo */ })
  }, deps.batimentoMs ?? Math.max(5_000, (deps.vtSegundos * 1000) / 3))

  try {
    const ctx = {
      banco, armazenamento: deps.armazenamento, worker, run, agente,
      clienteDoCaso: contexto.client_id, scratch, entrada, operacao: conteudo.data.operation, registro,
    }
    const metricas = await deps.executar(ctx, criarFerramentas(ctx))
    if (reservaPerdida) return 'reservada_por_outro'

    const destino = registro.propostas.length > 0 ? 'WAITING_HUMAN' : 'COMPLETED'
    await encerrar(deps, run.id, msg.msg_id, destino, {}, metricas, registro)
    return destino === 'WAITING_HUMAN' ? 'aguardando_humano' : 'concluida'
  } catch (e) {
    if (reservaPerdida) return 'reservada_por_outro'
    const metricas = (e as { metricas?: Metricas }).metricas
    const produziuSaida = registro.propostas.length > 0 || registro.documentos.length > 0

    if (msg.read_ct >= deps.maxTentativas || produziuSaida) {
      await encerrar(deps, run.id, msg.msg_id, 'FAILED', {
        error_code: produziuSaida ? 'PARTIAL_OUTPUT' : 'AGENT_ERROR',
        error_message: mensagemDe(e),
      }, metricas, registro)
      return 'falhou'
    }

    // Volta para a fila com espera crescente; a mesma mensagem reaparece.
    await banco.query(`select private.worker_requeue_run($1::uuid, $2::text, $3::text)`,
      [run.id, worker, mensagemDe(e)])
    await banco.query(`select pgmq.set_vt($1::text, $2::bigint, $3::int)`,
      [FILA, msg.msg_id, 30 * msg.read_ct])
    return 'reenfileirada'
  } finally {
    clearInterval(batimento)
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Configuração de IA (agente, versão, skills): leitura direta, sem dado de cliente. */
async function carregarAgente(banco: Banco, run: AgentRun): Promise<AgenteCarregado> {
  const a = await um<{
    id: string; slug: string; name: string; status: string; deleted_at: string | null
    instructions: string; configuration: unknown
  }>(
    banco,
    `select a.id, a.slug, a.name, a.status, a.deleted_at, v.instructions, v.configuration
     from public.agents a
     join public.agent_versions v on v.id = $2::uuid and v.agent_id = a.id
     where a.id = $1::uuid`,
    [run.agent_id, run.agent_version_id],
  )
  if (!a) throw Object.assign(new Error('Agente ou versão não encontrados'), { codigo: 'AGENT_NOT_FOUND' })
  if (a.status !== 'ACTIVE' || a.deleted_at) {
    throw Object.assign(new Error(`Agente ${a.slug} não está ativo`), { codigo: 'AGENT_INACTIVE' })
  }

  const config = ConfigAgente.safeParse(a.configuration ?? {})
  if (!config.success) {
    throw Object.assign(new Error(`Configuração inválida: ${config.error.message}`), { codigo: 'INVALID_CONFIGURATION' })
  }

  const { rows: skills } = await banco.query<{ slug: string; instructions: string }>(
    `select s.slug, sv.instructions
     from public.agent_skill_bindings b
     join public.skills s on s.id = b.skill_id
     join public.skill_versions sv on sv.id = s.current_version_id
     where b.agent_id = $1::uuid and b.enabled and s.status = 'ACTIVE' and s.deleted_at is null
     order by s.slug`,
    [a.id],
  )

  return {
    id: a.id, slug: a.slug, name: a.name, versionId: run.agent_version_id,
    instructions: a.instructions, config: config.data, skills,
  }
}

/** Status final, só por quem tem a reserva; arquiva a mensagem. */
async function encerrar(
  deps: Dependencias,
  runId: string,
  msgId: string,
  status: 'COMPLETED' | 'WAITING_HUMAN' | 'FAILED',
  erro: { error_code?: string; error_message?: string },
  metricas?: Metricas,
  registro?: Registro,
) {
  // Só nomes de ferramentas e ids vão para metadata. Nunca conteúdo.
  const resumo = registro && {
    tools_used: registro.ferramentas,
    denied_tools: registro.negadas,
    proposals: registro.propostas,
  }
  await deps.banco.query(
    `select private.worker_finish_run($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
                                      $7::bigint, $8::bigint, $9::numeric, $10::jsonb)`,
    [
      runId, deps.worker, status, erro.error_code ?? null, erro.error_message?.slice(0, 2000) ?? null,
      metricas?.modelo ?? null, metricas?.tokensEntrada ?? null, metricas?.tokensSaida ?? null,
      metricas?.custoUsd ?? null, resumo ? JSON.stringify(resumo) : null,
    ],
  )
  await arquivar(deps.banco, msgId)
}

function mensagemDe(e: unknown): string {
  // Sem stack trace: ele pode carregar trechos de dados. Só a mensagem.
  return (e instanceof Error ? e.message : String(e)).slice(0, 2000)
}
