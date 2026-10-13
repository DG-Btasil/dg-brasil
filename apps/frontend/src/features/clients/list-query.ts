import type { ClientKind } from "@/lib/constants/status";

/**
 * Estado da lista de clientes ↔ URL ↔ entrada da Server Action.
 *
 * A URL guarda filtros, ordem e página (recarregar/voltar mantém a lista).
 * A BUSCA só vai para a URL quando não tem dígitos: CPF/CNPJ (mesmo parcial)
 * nunca fica em endereço, histórico ou log de acesso.
 */

export type ClientLifecycle = "active" | "inactive" | "all";
export type ClientSortField = "name" | "updatedAt" | "createdAt";

export interface ClientListQuery {
  search: string;
  lifecycle: ClientLifecycle;
  kind: ClientKind | "";
  responsible: string;
  origin: string;
  sort: ClientSortField;
  direction: "asc" | "desc";
  page: number;
}

export const CLIENT_PAGE_SIZE = 25;

export const DEFAULT_CLIENT_QUERY: ClientListQuery = {
  search: "",
  lifecycle: "all",
  kind: "",
  responsible: "",
  origin: "",
  sort: "updatedAt",
  direction: "desc",
  page: 1,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORT_PARAM: Record<ClientSortField, string> = { name: "nome", updatedAt: "atualizado", createdAt: "cadastro" };
const LIFECYCLE_PARAM: Record<Exclude<ClientLifecycle, "all">, string> = { active: "ativos", inactive: "inativos" };
const KIND_PARAM: Record<ClientKind, string> = { INDIVIDUAL: "pf", COMPANY: "pj" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const keyOf = <K extends string>(map: Record<K, string>, value: string) => (Object.keys(map) as K[]).find((k) => map[k] === value);

/** Busca que pode ir para a URL (sem dígitos = não é documento). */
export const isUrlSafeSearch = (search: string) => !/\d/.test(search);

export function clientQueryFromSearchParams(params: Record<string, string | string[] | undefined>): ClientListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const page = Number.parseInt(first(params.pagina), 10);
  const responsible = first(params.responsavel);
  const origin = first(params.origem);
  const sort = keyOf(SORT_PARAM, first(params.ordem)) ?? DEFAULT_CLIENT_QUERY.sort;
  const dir = first(params.dir);
  return {
    search: isUrlSafeSearch(search) ? search : "",
    lifecycle: keyOf(LIFECYCLE_PARAM, first(params.situacao)) ?? "all",
    kind: keyOf(KIND_PARAM, first(params.tipo)) ?? "",
    responsible: UUID.test(responsible) ? responsible : "",
    origin: UUID.test(origin) ? origin : "",
    sort,
    direction: dir === "asc" || dir === "desc" ? dir : sort === "name" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function clientQueryToSearchParams(q: ClientListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafeSearch(q.search)) p.set("busca", q.search);
  if (q.lifecycle !== "all") p.set("situacao", LIFECYCLE_PARAM[q.lifecycle]);
  if (q.kind) p.set("tipo", KIND_PARAM[q.kind]);
  if (q.responsible) p.set("responsavel", q.responsible);
  if (q.origin) p.set("origem", q.origin);
  if (q.sort !== DEFAULT_CLIENT_QUERY.sort || q.direction !== DEFAULT_CLIENT_QUERY.direction) {
    p.set("ordem", SORT_PARAM[q.sort]);
    p.set("dir", q.direction);
  }
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

/** Entrada de `listClientsAction` (o servidor valida de novo). */
export function clientQueryToInput(q: ClientListQuery): Record<string, unknown> {
  return {
    page: q.page,
    pageSize: CLIENT_PAGE_SIZE,
    q: q.search.trim() || undefined,
    status: q.lifecycle === "active" ? "ACTIVE" : q.lifecycle === "inactive" ? "INACTIVE" : undefined,
    kind: q.kind || undefined,
    responsibleUserId: q.responsible || undefined,
    originOrganizationId: q.origin || undefined,
    sortBy: q.sort,
    sortDirection: q.direction,
  };
}

export function hasClientFilters(q: ClientListQuery): boolean {
  return !!(q.search || q.kind || q.responsible || q.origin || q.lifecycle !== "all");
}
