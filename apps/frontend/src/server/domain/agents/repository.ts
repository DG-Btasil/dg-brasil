import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/server/core/db-errors";
import type { AgentRunSummaryPageRow, AgentRunSummaryRow } from "./mappers";

/**
 * Acesso a dados de execução de agente. A tabela agent_runs é só de ADMIN:
 * pedido é SEMPRE por request_agent_run_once (026: chave de idempotência por
 * solicitante; repetir devolve a mesma execução sem enfileirar de novo) e
 * leitura do advogado é SEMPRE pela RPC get_agent_run_summaries. Nenhum
 * agente é executado aqui — o worker consome a fila.
 */

export async function requestRunOnce(
  db: SupabaseClient,
  params: {
    idempotencyKey: string;
    agentId: string;
    legalCaseId: string | null;
    processId: string | null;
    requestText: string | null;
    parameters: Record<string, string>;
    operation: string;
  },
): Promise<{ runId: string; deduplicated: boolean }> {
  const data = unwrap(
    await db.rpc("request_agent_run_once", {
      p_idempotency_key: params.idempotencyKey,
      p_agent_id: params.agentId,
      p_legal_case_id: params.legalCaseId,
      p_legal_process_id: params.processId,
      p_request_text: params.requestText,
      p_parameters: params.parameters,
      p_operation: params.operation,
    }),
  ) as { run_id: string; deduplicated: boolean };
  return { runId: data.run_id, deduplicated: data.deduplicated === true };
}

export async function summaries(db: SupabaseClient, legalCaseId: string | null, limit: number): Promise<AgentRunSummaryRow[]> {
  return (unwrap(await db.rpc("get_agent_run_summaries", { p_legal_case_id: legalCaseId, p_limit: limit })) ?? []) as AgentRunSummaryRow[];
}

/** Página de resumos (031): mesmas regras de acesso da RPC antiga; total em cada linha. */
export async function summariesPage(
  db: SupabaseClient,
  filters: { legalCaseId?: string; status?: string; agentId?: string },
  offset: number,
  limit: number,
): Promise<{ rows: AgentRunSummaryPageRow[]; total: number }> {
  const rows = (unwrap(
    await db.rpc("get_agent_run_summaries_page", {
      p_legal_case_id: filters.legalCaseId ?? null,
      p_status: filters.status ?? null,
      p_agent_id: filters.agentId ?? null,
      p_offset: offset,
      p_limit: limit,
    }),
  ) ?? []) as AgentRunSummaryPageRow[];
  return { rows, total: rows.length ? Number(rows[0].total_count ?? 0) : 0 };
}

/**
 * Interromper (033): request_agent_run_cancel decide tudo no banco — QUEUED
 * cancela na hora (e arquiva a mensagem), RUNNING vira pedido que o worker
 * confirma, repetir devolve o mesmo resultado. ADMIN ou LAWYER do caso.
 */
export async function requestCancel(db: SupabaseClient, id: string): Promise<{ agent_run_id: string; status: string; outcome: string }> {
  return unwrap(await db.rpc("request_agent_run_cancel", { p_agent_run_id: id })) as { agent_run_id: string; status: string; outcome: string };
}

/** Pedido de interrupção pendente (033). Só ids que o usuário pode ver; no máximo 100. */
export async function cancelState(db: SupabaseClient, ids: string[]): Promise<Map<string, boolean>> {
  if (ids.length === 0) return new Map();
  const rows = (unwrap(await db.rpc("get_agent_run_cancel_state", { p_ids: ids.slice(0, 100) })) ?? []) as { agent_run_id: string; cancel_requested: boolean }[];
  return new Map(rows.map((r) => [r.agent_run_id, r.cancel_requested === true]));
}

/** Detalhe de uma execução (039): mesmo acesso das listas; uso e configuração só para ADMIN. */
export async function detail(db: SupabaseClient, id: string): Promise<Record<string, unknown>> {
  return unwrap(await db.rpc("get_agent_run_detail", { p_agent_run_id: id })) as Record<string, unknown>;
}

/** Nova tentativa de execução avulsa (039), idempotente pela chave. */
export async function retry(db: SupabaseClient, key: string, id: string): Promise<{ agent_run_id: string; retry_of_agent_run_id: string; deduplicated: boolean }> {
  return unwrap(await db.rpc("retry_agent_run_once", { p_key: key, p_agent_run_id: id })) as never;
}
