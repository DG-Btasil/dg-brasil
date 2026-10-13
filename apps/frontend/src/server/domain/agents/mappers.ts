import type { AgentRunSummaryDTO } from "./dto";
import type { AgentRunStatus } from "./schemas";

/**
 * Banco ↔ domínio das execuções de agente. Funções puras, testadas em
 * agents.test.ts (inclusive a regra de duplo clique).
 */

/** Linha de get_agent_run_summaries (colunas fixas da RPC). */
export interface AgentRunSummaryRow {
  id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  legal_case_id: string | null;
  legal_process_id: string | null;
  status: AgentRunStatus;
  operation: string;
  requested_by: string | null;
  attempt: number;
  error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** bigint: o PostgREST pode devolver número ou texto. */
  proposal_count: number | string | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function summaryFromRow(row: AgentRunSummaryRow): AgentRunSummaryDTO {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentSlug: row.agent_slug,
    agentName: row.agent_name,
    legalCaseId: opt(row.legal_case_id),
    processId: opt(row.legal_process_id),
    status: row.status,
    operation: row.operation,
    requestedById: opt(row.requested_by),
    attempt: row.attempt,
    errorCode: opt(row.error_code),
    createdAt: row.created_at,
    startedAt: opt(row.started_at),
    completedAt: opt(row.completed_at),
    proposalCount: Number(row.proposal_count ?? 0),
  };
}

/** Janela do "duplo clique": o mesmo pedido repetido dentro dela devolve a execução existente. */
export const DUPLICATE_WINDOW_MS = 30_000;

export interface RunIdentity {
  agentId: string;
  legalCaseId: string | null;
  processId: string | null;
  operation: string;
  requestedBy: string;
}

/**
 * Execução idêntica ainda na fila (mesmo agente, caso, processo, operação e
 * solicitante), pedida há menos de `windowMs`. Proteção de aplicação contra
 * duplo clique — o banco não tem chave de idempotência para execução (ver
 * relatório da 4.2: proposta de `agent_runs.idempotency_key`).
 */
export function findRecentDuplicate(rows: AgentRunSummaryRow[], run: RunIdentity, now: number, windowMs = DUPLICATE_WINDOW_MS): AgentRunSummaryRow | undefined {
  return rows.find(
    (r) =>
      r.status === "QUEUED" &&
      r.agent_id === run.agentId &&
      (r.legal_case_id ?? null) === run.legalCaseId &&
      (r.legal_process_id ?? null) === run.processId &&
      r.operation === run.operation &&
      r.requested_by === run.requestedBy &&
      now - Date.parse(r.created_at) >= -5_000 && // relógios de servidor e banco podem divergir um pouco
      now - Date.parse(r.created_at) < windowMs,
  );
}
