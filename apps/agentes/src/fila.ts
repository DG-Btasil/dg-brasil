import { consulta, um } from './db.js'
import type { Agente, Execucao } from './tipos.js'

/**
 * Pega a próxima execução pendente. `reservar_execucao` usa FOR UPDATE SKIP
 * LOCKED, então vários workers podem rodar em paralelo sem disputar a mesma
 * linha — e sem Redis no meio.
 */
export async function proximaExecucao(worker: string, segundosReserva = 900) {
  const e = await um<Execucao>(
    'select * from reservar_execucao($1, $2)',
    [worker, segundosReserva],
  )
  if (!e?.id) return null

  const agente = await um<Agente>('select * from agente where id = $1', [e.agente_id])
  if (!agente) throw new Error(`execução ${e.id} aponta para agente inexistente`)
  return { execucao: e, agente }
}

export async function registrarPasso(
  execucaoId: string,
  ordem: number,
  tipo: 'texto' | 'ferramenta' | 'raciocinio' | 'erro',
  dados: { ferramenta?: string; entrada?: unknown; saida?: unknown },
) {
  await consulta(
    `insert into passo_execucao (execucao_id, ordem, tipo, ferramenta, entrada, saida)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (execucao_id, ordem) do nothing`,
    [
      execucaoId,
      ordem,
      tipo,
      dados.ferramenta ?? null,
      dados.entrada === undefined ? null : JSON.stringify(dados.entrada),
      dados.saida === undefined ? null : JSON.stringify(dados.saida),
    ],
  )
}

export async function concluir(
  execucaoId: string,
  metricas: { tokensEntrada?: number; tokensSaida?: number; custoUsd?: number },
) {
  // Se o agente deixou proposta pendente, a execução fica aguardando humano —
  // não "concluída". A fila do painel é alimentada por este estado.
  const pendentes = await um<{ n: string }>(
    `select count(*)::text as n from proposta
     where execucao_id = $1 and status = 'pendente'`,
    [execucaoId],
  )
  const temPendente = Number(pendentes?.n ?? 0) > 0

  await consulta(
    `update execucao
     set status = $2,
         terminado_em = now(),
         tokens_entrada = $3,
         tokens_saida = $4,
         custo_usd = $5,
         reservado_por = null,
         reservado_ate = null
     where id = $1`,
    [
      execucaoId,
      temPendente ? 'aguardando_aprovacao' : 'concluida',
      metricas.tokensEntrada ?? null,
      metricas.tokensSaida ?? null,
      metricas.custoUsd ?? null,
    ],
  )
  return temPendente ? 'aguardando_aprovacao' : 'concluida'
}

export async function falhar(execucao: Execucao, erro: unknown) {
  const msg = erro instanceof Error ? `${erro.message}\n${erro.stack ?? ''}` : String(erro)
  const esgotou = execucao.tentativas >= execucao.max_tentativas

  await consulta(
    `update execucao
     set status = $2,
         erro = $3,
         reservado_por = null,
         reservado_ate = null,
         disponivel_em = now() + make_interval(secs => $4),
         terminado_em = case when $2 = 'falhou' then now() else null end
     where id = $1`,
    [
      execucao.id,
      esgotou ? 'falhou' : 'pendente',
      msg.slice(0, 8000),
      esgotou ? 0 : 30 * execucao.tentativas, // backoff linear
    ],
  )
  return esgotou ? 'falhou' : 'reenfileirada'
}

/** Devolve à fila o que ficou preso num worker que morreu. */
export async function liberarExpiradas() {
  const r = await um<{ liberar_execucoes_expiradas: number }>(
    'select liberar_execucoes_expiradas()',
  )
  return r?.liberar_execucoes_expiradas ?? 0
}
