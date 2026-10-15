import type { Banco } from './banco.js'

/**
 * O outro lado do gate: proposta decidida em Revisões vira fato.
 *
 * A aplicação mora no banco (private.worker_apply_next_proposal, migration
 * 018) — é o ÚNICO lugar que transforma proposta aprovada por humano em linha
 * de prazo, pendência, processo, caso, skill ou agente. Assim o dg_worker não
 * precisa de escrita direta em nenhuma dessas tabelas.
 *
 *  - A decisão humana (public.decide_review) já leva a proposta a APPROVED ou
 *    REJECTED. O banco também cobre o caminho antigo (PENDING com revisão
 *    decidida).
 *  - Cada chamada pega UMA proposta (for update skip locked: dois workers não
 *    aplicam a mesma), aplica e grava APPLIED com applied_entity_* na mesma
 *    transação. APPLIED não volta: efeito único por proposta.
 *  - Falha de aplicação deixa a proposta FAILED com o erro em
 *    application_error, visível na tela. Nada fica sem efeito em silêncio.
 *  - A auditoria registra actor_type AGENT com a execução.
 */
export async function aplicarDecididas(banco: Banco, worker = 'worker', limite = 10): Promise<number> {
  let processadas = 0

  for (let i = 0; i < limite; i++) {
    const { rows } = await banco.query<{ proposal_id: string; status: string; error: string | null }>(
      `select proposal_id, status, error from private.worker_apply_next_proposal($1::text)`, [worker])
    const r = rows[0]
    if (!r) break
    processadas++
    if (r.status === 'FAILED') console.error(`proposta ${r.proposal_id} falhou ao aplicar: ${r.error}`)
  }

  // Execuções cujas propostas foram todas decididas (ex.: rejeitadas) terminam aqui.
  const { rows } = await banco.query<{ n: number }>(`select private.worker_close_decided_runs() as n`)
  return processadas + Number(rows[0]?.n ?? 0)
}

/**
 * Lembretes de prazo (migration 037): "prazo próximo" (até 48 h) e "prazo
 * vencido", uma vez por prazo e tipo — o banco garante (chave de evento).
 * Barato e idempotente: o laço chama no máximo a cada `intervaloMs`.
 */
let ultimoLembrete = 0
export async function lembrarPrazos(banco: Banco, agora = Date.now(), intervaloMs = 15 * 60_000): Promise<number> {
  if (agora - ultimoLembrete < intervaloMs) return 0
  ultimoLembrete = agora
  const { rows } = await banco.query<{ n: number }>(`select private.notify_deadline_reminders() as n`)
  return Number(rows[0]?.n ?? 0)
}
