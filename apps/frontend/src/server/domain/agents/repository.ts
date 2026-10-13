import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import type { AgentRunSummaryRow } from "./mappers";

/**
 * Acesso a dados de execução de agente. A tabela agent_runs é só de ADMIN:
 * pedido é SEMPRE por request_agent_run e leitura do advogado é SEMPRE pela
 * RPC get_agent_run_summaries (colunas fixas, autorização no banco). Nenhum
 * agente é executado aqui — o worker consome a fila.
 */

export async function requestRun(
  db: SupabaseClient,
  params: { agentId: string; legalCaseId: string | null; processId: string | null; requestText: string | null; parameters: Record<string, string>; operation: string },
): Promise<string> {
  return unwrap(
    await db.rpc("request_agent_run", {
      p_agent_id: params.agentId,
      p_legal_case_id: params.legalCaseId,
      p_legal_process_id: params.processId,
      p_request_text: params.requestText,
      p_parameters: params.parameters,
      p_operation: params.operation,
    }),
  ) as string;
}

export async function summaries(db: SupabaseClient, legalCaseId: string | null, limit: number): Promise<AgentRunSummaryRow[]> {
  return (unwrap(await db.rpc("get_agent_run_summaries", { p_legal_case_id: legalCaseId, p_limit: limit })) ?? []) as AgentRunSummaryRow[];
}

/** ADMIN cancela (política agent_runs_cancel_admin: só de QUEUED/RUNNING/WAITING_HUMAN para CANCELLED). */
export async function cancel(db: SupabaseClient, id: string): Promise<number> {
  const { error, count } = await db
    .from("agent_runs")
    .update({ status: "CANCELLED" }, { count: "exact" })
    .eq("id", id)
    .in("status", ["QUEUED", "RUNNING", "WAITING_HUMAN"]);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

/** Só ADMIN (RLS agent_runs_select_admin). Existe para distinguir "não encontrada" de "já encerrada". */
export async function adminRunExists(db: SupabaseClient, id: string): Promise<boolean> {
  const data = unwrap(await db.from("agent_runs").select("id").eq("id", id).maybeSingle());
  return data !== null;
}
