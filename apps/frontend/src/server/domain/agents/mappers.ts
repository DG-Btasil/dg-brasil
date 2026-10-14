import type { AgentRunSummaryDTO } from "./dto";
import type { AgentRunStatus } from "./schemas";

/**
 * Banco ↔ domínio das execuções de agente. Funções puras, testadas em
 * agents.test.ts.
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

/** Linha de get_agent_run_summaries_page (031): as mesmas colunas + o total filtrado. */
export interface AgentRunSummaryPageRow extends AgentRunSummaryRow {
  total_count: number | string | null;
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
