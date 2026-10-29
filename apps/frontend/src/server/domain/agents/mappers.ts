import type { AgentRunDetailDTO, AgentRunSummaryDTO } from "./dto";
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

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function detailFromJson(d: Record<string, unknown>): AgentRunDetailDTO {
  const agent = (d.agent ?? {}) as Record<string, unknown>;
  const usage = d.usage as Record<string, unknown> | null | undefined;
  const result = d.analysis_result as Record<string, unknown> | null | undefined;
  return {
    id: String(d.id),
    agent: { id: String(agent.id), name: String(agent.name ?? ""), slug: String(agent.slug ?? "") },
    status: d.status as AgentRunStatus,
    cancelRequested: d.cancel_requested === true,
    errorCode: str(d.error_code),
    attempt: Number(d.attempt ?? 0),
    legalCaseId: str(d.legal_case_id),
    processId: str(d.legal_process_id),
    createdAt: String(d.created_at),
    startedAt: str(d.started_at),
    completedAt: str(d.completed_at),
    retryOfId: str(d.retry_of_agent_run_id),
    retriedByIds: Array.isArray(d.retried_by) ? (d.retried_by as string[]) : [],
    analysisId: str(d.analysis_id),
    proposals: arr(d.proposals).map((p) => ({
      id: String(p.id), type: String(p.type), status: String(p.status), summary: str(p.summary), reviewId: str(p.review_id), applicationError: str(p.application_error),
    })),
    documents: arr(d.documents).map((x) => ({
      versionId: String(x.version_id), documentId: String(x.document_id), title: String(x.title ?? ""), versionNumber: Number(x.version_number ?? 0),
      reviewId: str(x.review_id), reviewStatus: str(x.review_status),
    })),
    analysisResult: result ? { id: String(result.id), summary: String(result.summary ?? ""), reviewId: str(result.review_id), reviewStatus: str(result.review_status) } : undefined,
    executorName: str((d.executor as Record<string, unknown> | null | undefined)?.name),
    progress: d.progress ? { message: String((d.progress as Record<string, unknown>).message ?? ""), at: String((d.progress as Record<string, unknown>).at ?? "") } : undefined,
    events: arr(d.events).map((e) => ({
      kind: String(e.kind), from: str(e.from), to: str(e.to), message: str(e.message), documentVersionId: str(e.document_version_id), at: String(e.at),
    })),
    usage: usage
      ? {
          provider: String(usage.provider ?? ""), model: str(usage.model), inputTokens: num(usage.input_tokens), outputTokens: num(usage.output_tokens),
          estimatedCost: num(usage.estimated_cost), currency: str(usage.currency),
          details: (usage.details ?? undefined) as Record<string, unknown> | undefined,
          toolsUsed: (usage.tools_used ?? undefined) as Record<string, number> | undefined,
          errorMessage: str(usage.error_message),
          executorReport: (usage.executor_report ?? undefined) as Record<string, unknown> | undefined,
        }
      : undefined,
    config: (d.config ?? undefined) as Record<string, unknown> | undefined,
  };
}
