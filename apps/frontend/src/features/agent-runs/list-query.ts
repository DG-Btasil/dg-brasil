import { AGENT_RUN_STATUSES, type AgentRunStatus } from "@/server/domain/agents/schemas";

/** Lista de execuções ↔ URL ↔ entrada de `listAgentRunsAction` (031). Nada de pedido em texto na URL. */

export interface AgentRunListQuery {
  status: AgentRunStatus | "";
  page: number;
}

export const AGENT_RUN_PAGE_SIZE = 25;
export const DEFAULT_AGENT_RUN_QUERY: AgentRunListQuery = { status: "", page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function agentRunQueryFromSearchParams(params: Record<string, string | string[] | undefined>): AgentRunListQuery {
  const status = first(params.situacao);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    status: (AGENT_RUN_STATUSES as readonly string[]).includes(status) ? (status as AgentRunStatus) : "",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function agentRunQueryToSearchParams(q: AgentRunListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.status) p.set("situacao", q.status);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function agentRunQueryToInput(q: AgentRunListQuery, scope: { legalCaseId?: string; agentId?: string } = {}): Record<string, unknown> {
  return { ...scope, status: q.status || undefined, page: q.page, pageSize: AGENT_RUN_PAGE_SIZE };
}
