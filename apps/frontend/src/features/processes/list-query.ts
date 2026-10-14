import { COURTS } from "@/lib/constants/legal";
import { PROCESS_ORIGINS, PROCESS_PHASES, PROCESS_STATUSES, type ProcessOrigin, type ProcessPhase, type ProcessStatus } from "@/lib/constants/status";
import type { ProcessSortField } from "./components/process-list-table";
import type { ProcessDeadlineFilter } from "@/server/domain/processes/schemas";

/**
 * Estado da lista de processos ↔ URL ↔ entrada de `listProcessesAction`.
 * Busca com dígitos (CNJ, ou um CPF colado por engano) não vai para a URL.
 */

export interface ProcessListQuery {
  search: string;
  status: ProcessStatus | "";
  phase: ProcessPhase | "";
  court: string;
  responsible: string;
  clientId: string;
  origin: ProcessOrigin | "";
  caseOrigin: string;
  /** Prazo em aberto: vencido ou em até 5 dias (inclui vencidos). Só equipe interna. */
  deadline: ProcessDeadlineFilter | "";
  sort: ProcessSortField;
  direction: "asc" | "desc";
  page: number;
}

export const PROCESS_PAGE_SIZE = 25;

export const DEFAULT_PROCESS_QUERY: ProcessListQuery = {
  search: "",
  status: "",
  phase: "",
  court: "",
  responsible: "",
  clientId: "",
  origin: "",
  caseOrigin: "",
  deadline: "",
  sort: "updatedAt",
  direction: "desc",
  page: 1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEADLINE_PARAM: Record<ProcessDeadlineFilter, string> = { OVERDUE: "vencidos", NEXT_5_DAYS: "5dias" };
const SORT_PARAM: Record<ProcessSortField, string> = { updatedAt: "atualizado", createdAt: "cadastro", title: "titulo", cnj: "cnj", distributionDate: "distribuicao" };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(values: readonly T[], v: string): T | "" => ((values as readonly string[]).includes(v) ? (v as T) : "");
const isUrlSafe = (s: string) => !/\d/.test(s);

export function processQueryFromSearchParams(params: Record<string, string | string[] | undefined>): ProcessListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const page = Number.parseInt(first(params.pagina), 10);
  const sort = (Object.keys(SORT_PARAM) as ProcessSortField[]).find((k) => SORT_PARAM[k] === first(params.ordem)) ?? "updatedAt";
  const dir = first(params.dir);
  const uuid = (v: string) => (UUID.test(v) ? v : "");
  return {
    search: isUrlSafe(search) ? search : "",
    status: oneOf(PROCESS_STATUSES, first(params.status)),
    phase: oneOf(PROCESS_PHASES, first(params.fase)),
    court: oneOf(COURTS, first(params.tribunal)),
    responsible: uuid(first(params.responsavel)),
    clientId: uuid(first(params.cliente)),
    origin: oneOf(PROCESS_ORIGINS, first(params.cadastro)),
    caseOrigin: uuid(first(params.origem)),
    deadline: (Object.keys(DEADLINE_PARAM) as ProcessDeadlineFilter[]).find((k) => DEADLINE_PARAM[k] === first(params.prazo)) ?? "",
    sort,
    direction: dir === "asc" || dir === "desc" ? dir : sort === "title" || sort === "cnj" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function processQueryToSearchParams(q: ProcessListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.status) p.set("status", q.status);
  if (q.phase) p.set("fase", q.phase);
  if (q.court) p.set("tribunal", q.court);
  if (q.responsible) p.set("responsavel", q.responsible);
  if (q.clientId) p.set("cliente", q.clientId);
  if (q.origin) p.set("cadastro", q.origin);
  if (q.caseOrigin) p.set("origem", q.caseOrigin);
  if (q.deadline) p.set("prazo", DEADLINE_PARAM[q.deadline]);
  if (q.sort !== DEFAULT_PROCESS_QUERY.sort || q.direction !== DEFAULT_PROCESS_QUERY.direction) {
    p.set("ordem", SORT_PARAM[q.sort]);
    p.set("dir", q.direction);
  }
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Entrada de `listProcessesAction` (o servidor valida de novo). */
export function processQueryToInput(q: ProcessListQuery): Record<string, unknown> {
  return {
    page: q.page,
    pageSize: PROCESS_PAGE_SIZE,
    q: q.search.trim() || undefined,
    status: q.status || undefined,
    phase: q.phase || undefined,
    court: q.court || undefined,
    responsibleUserId: q.responsible || undefined,
    clientId: q.clientId || undefined,
    technicalOrigin: q.origin || undefined,
    caseOriginOrganizationId: q.caseOrigin || undefined,
    deadline: q.deadline || undefined,
    sortBy: q.sort,
    sortDirection: q.direction,
  };
}

export function countProcessFilters(q: ProcessListQuery): number {
  return [q.search, q.status, q.phase, q.court, q.responsible, q.clientId, q.origin, q.caseOrigin, q.deadline].filter(Boolean).length;
}
