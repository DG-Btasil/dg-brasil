import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Armazenamento } from './armazenamento.js'
import { um, type Banco } from './banco.js'
import { criarFerramentas } from './ferramentas.js'
import {
  ConfigAgente, MensagemFila,
  type AgenteCarregado, type AgentRun, type ExecutarAgente, type Metricas, type Registro,
} from './tipos.js'

/**
 * Consumo da fila agent_execution (pgmq).
 *
 * agent_runs é o registro; a mensagem só carrega o id. O pgmq dá a garantia
 * que antes era feita à mão: mensagem lida fica invisível por VT segundos; se o
 * worker morrer, ela reaparece sozinha. read_ct conta as tentativas.
 */

export const FILA = 'agent_execution'

export interface Dependencias {
  banco: Banco
  armazenamento: Armazenamento
  executar: ExecutarAgente
  worker: string
  maxTentativas: number
  /** Segundos de invisibilidade da mensagem enquanto a execução roda. */
  vtSegundos: number
}

export interface MensagemLida {
  msg_id: string
  read_ct: number
  message: unknown
}

export type Desfecho =
  | 'concluida' | 'aguardando_humano' | 'falhou' | 'reenfileirada' | 'ignorada'

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
  const { banco } = deps

  const conteudo = MensagemFila.safeParse(msg.message)
  if (!conteudo.success) {
    // Mensagem fora do contrato não tem como dar certo numa nova tentativa.
    await arquivar(banco, msg.msg_id)
    return 'ignorada'
  }

  const run = await um<AgentRun>(
    banco,
    `select id, agent_id, agent_version_id, legal_case_id, legal_process_id, status, requested_by, metadata
     from public.agent_runs where id = $1::uuid`,
    [conteudo.data.agent_run_id],
  )
  if (!run || TERMINAIS.has(run.status)) {
    await arquivar(banco, msg.msg_id)
    return 'ignorada'
  }

  // Tentativa anterior que já deixou proposta ou minuta não é refeita: rodar de
  // novo duplicaria o que está em Revisões. Fica para um humano decidir.
  const saidaAnterior = await um<{ n: string | number }>(
    banco,
    `select count(*) as n from public.agent_proposals where agent_run_id = $1::uuid`,
    [run.id],
  )
  const docsAnteriores = Array.isArray(run.metadata?.documents) ? run.metadata.documents.length : 0
  if (Number(saidaAnterior?.n ?? 0) > 0 || docsAnteriores > 0) {
    await encerrar(banco, run.id, msg.msg_id, 'FAILED', {
      error_code: 'PARTIAL_OUTPUT',
      error_message: 'Uma tentativa anterior foi interrompida depois de gerar propostas ou minutas. ' +
        'Confira em Revisões e dispare de novo se precisar.',
    })
    return 'falhou'
  }

  if (msg.read_ct > deps.maxTentativas) {
    await encerrar(banco, run.id, msg.msg_id, 'FAILED', {
      error_code: 'MAX_ATTEMPTS',
      error_message: `Excedeu ${deps.maxTentativas} tentativas.`,
    })
    return 'falhou'
  }

  await banco.query(
    `update public.agent_runs
        set status = 'RUNNING', started_at = coalesce(started_at, now()),
            error_code = null, error_message = null,
            metadata = metadata || jsonb_build_object('worker', $2::text, 'attempt', $3::int)
      where id = $1::uuid`,
    [run.id, deps.worker, msg.read_ct],
  )

  let agente: AgenteCarregado
  try {
    agente = await carregarAgente(banco, run)
  } catch (e) {
    // Agente inativo ou configuração inválida: outra tentativa não muda nada.
    await encerrar(banco, run.id, msg.msg_id, 'FAILED', {
      error_code: (e as { codigo?: string }).codigo ?? 'AGENT_LOAD_ERROR',
      error_message: mensagemDe(e),
    })
    return 'falhou'
  }

  const clienteDoCaso = run.legal_case_id
    ? (await um<{ client_id: string }>(banco,
        `select client_id from public.legal_cases where id = $1::uuid`, [run.legal_case_id]))?.client_id ?? null
    : null

  const registro: Registro = { ferramentas: {}, negadas: [], propostas: [], documentos: [] }
  const scratch = await mkdtemp(join(tmpdir(), `dgbrasil-${agente.slug}-`))

  try {
    const ctx = {
      banco, armazenamento: deps.armazenamento, run, agente, clienteDoCaso, scratch,
      operacao: conteudo.data.operation, registro,
    }
    const metricas = await deps.executar(ctx, criarFerramentas(ctx))

    const destino = registro.propostas.length > 0 ? 'WAITING_HUMAN' : 'COMPLETED'
    await encerrar(banco, run.id, msg.msg_id, destino, {}, metricas, registro)
    return destino === 'WAITING_HUMAN' ? 'aguardando_humano' : 'concluida'
  } catch (e) {
    const metricas = (e as { metricas?: Metricas }).metricas
    const produziuSaida = registro.propostas.length > 0 || registro.documentos.length > 0

    if (msg.read_ct >= deps.maxTentativas || produziuSaida) {
      await encerrar(banco, run.id, msg.msg_id, 'FAILED', {
        error_code: produziuSaida ? 'PARTIAL_OUTPUT' : 'AGENT_ERROR',
        error_message: mensagemDe(e),
      }, metricas, registro)
      return 'falhou'
    }

    // Volta para a fila com espera crescente; a mesma mensagem reaparece.
    await banco.query(
      `update public.agent_runs
          set status = 'QUEUED', error_code = 'AGENT_ERROR', error_message = $2::text
        where id = $1::uuid`,
      [run.id, mensagemDe(e)],
    )
    await banco.query(`select pgmq.set_vt($1::text, $2::bigint, $3::int)`,
      [FILA, msg.msg_id, 30 * msg.read_ct])
    return 'reenfileirada'
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

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

async function encerrar(
  banco: Banco,
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
  await banco.query(
    `update public.agent_runs
        set status = $2::text,
            completed_at = case when $2::text in ('COMPLETED', 'FAILED') then now() else completed_at end,
            error_code = $3::text,
            error_message = $4::text,
            model = coalesce($5::text, model),
            input_tokens = coalesce($6::bigint, input_tokens),
            output_tokens = coalesce($7::bigint, output_tokens),
            estimated_cost = coalesce($8::numeric, estimated_cost),
            metadata = metadata || coalesce($9::jsonb, '{}'::jsonb)
      where id = $1::uuid`,
    [
      runId, status, erro.error_code ?? null, erro.error_message?.slice(0, 2000) ?? null,
      metricas?.modelo ?? null, metricas?.tokensEntrada ?? null, metricas?.tokensSaida ?? null,
      metricas?.custoUsd ?? null, resumo ? JSON.stringify(resumo) : null,
    ],
  )
  await arquivar(banco, msgId)
}

function mensagemDe(e: unknown): string {
  // Sem stack trace: ele pode carregar trechos de dados. Só a mensagem.
  return (e instanceof Error ? e.message : String(e)).slice(0, 2000)
}
