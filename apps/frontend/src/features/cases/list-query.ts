import { LEGAL_AREAS, type LegalArea } from "@/lib/constants/legal";
import { LEGAL_CASE_STATUSES, type LegalCaseStatus } from "@/lib/constants/status";

/**
 * Estado da lista de casos ↔ URL ↔ entrada de `listCasesAction`. Filtros,
 * ordem e página ficam na URL (recarregar/voltar mantém a lista). A busca é
 * por título ou parte contrária (não por documento), então pode ir na URL —
 * exceto se tiver dígitos, por precaução (nunca CPF/CNPJ em endereço).
 */

export type CaseSortField = "updatedAt" | "createdAt" | "submittedAt" | "title" | "status";
export const CASE_PERIODS = ["7", "30", "90"] as const;
export type CasePeriod = (typeof CASE_PERIODS)[number];

export interface CaseListQuery {
  search: string;
  status: LegalCaseStatus | "";
  area: LegalArea | "";
  lawyer: string;
  origin: string;
  clientId: string;
  period: CasePeriod | "";
  sort: CaseSortField;
  direction: "asc" | "desc";
  page: number;
}

export const CASE_PAGE_SIZE = 25;

export const DEFAULT_CASE_QUERY: CaseListQuery = {
  search: "",
  status: "",
  area: "",
  lawyer: "",
  origin: "",
  clientId: "",
  period: "",
  sort: "updatedAt",
  direction: "desc",
  page: 1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_PARAM: Record<CaseSortField, string> = { updatedAt: "atualizado", createdAt: "criado", submittedAt: "enviado", title: "titulo", status: "situacao" };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const oneOf = <T extends string>(values: readonly T[], v: string): T | "" => ((values as readonly string[]).includes(v) ? (v as T) : "");
const isUrlSafe = (s: string) => !/\d/.test(s);

export function caseQueryFromSearchParams(params: Record<string, string | string[] | undefined>): CaseListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const page = Number.parseInt(first(params.pagina), 10);
  const sort = (Object.keys(SORT_PARAM) as CaseSortField[]).find((k) => SORT_PARAM[k] === first(params.ordem)) ?? "updatedAt";
  const dir = first(params.dir);
  const uuid = (v: string) => (UUID.test(v) ? v : "");
  return {
    search: isUrlSafe(search) ? search : "",
    status: oneOf(LEGAL_CASE_STATUSES, first(params.situacao)),
    area: oneOf(LEGAL_AREAS, first(params.area)),
    lawyer: uuid(first(params.responsavel)),
    origin: uuid(first(params.origem)),
    clientId: uuid(first(params.cliente)),
    period: oneOf(CASE_PERIODS, first(params.periodo)),
    sort,
    direction: dir === "asc" || dir === "desc" ? dir : sort === "title" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function caseQueryToSearchParams(q: CaseListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.status) p.set("situacao", q.status);
  if (q.area) p.set("area", q.area);
  if (q.lawyer) p.set("responsavel", q.lawyer);
  if (q.origin) p.set("origem", q.origin);
  if (q.clientId) p.set("cliente", q.clientId);
  if (q.period) p.set("periodo", q.period);
  if (q.sort !== DEFAULT_CASE_QUERY.sort || q.direction !== DEFAULT_CASE_QUERY.direction) {
    p.set("ordem", SORT_PARAM[q.sort]);
    p.set("dir", q.direction);
  }
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Data (YYYY-MM-DD) de N dias atrás, no fuso do escritório. */
export function daysAgo(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Entrada de `listCasesAction` (o servidor valida de novo). */
export function caseQueryToInput(q: CaseListQuery, now = new Date()): Record<string, unknown> {
  return {
    page: q.page,
    pageSize: CASE_PAGE_SIZE,
    q: q.search.trim() || undefined,
    status: q.status || undefined,
    area: q.area || undefined,
    assignedLawyerId: q.lawyer || undefined,
    originOrganizationId: q.origin || undefined,
    clientId: q.clientId || undefined,
    createdFrom: q.period ? daysAgo(Number(q.period), now) : undefined,
    sortBy: q.sort,
    sortDirection: q.direction,
  };
}

export function countCaseFilters(q: CaseListQuery): number {
  return [q.search, q.status, q.area, q.lawyer, q.origin, q.clientId, q.period].filter(Boolean).length;
}
