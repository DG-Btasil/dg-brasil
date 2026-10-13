import { LEGAL_CASE_STATUSES, PARTNER_CASE_STATUS_LABEL, type LegalCaseStatus } from "@/lib/constants/status";

/**
 * Listas do Portal do Parceiro ↔ URL ↔ entrada das Server Actions.
 *
 * O escritório nunca vem do navegador: para o parceiro, a RLS já recorta as
 * listas aos próprios relacionamentos/casos. A URL guarda só busca (sem
 * dígitos — CPF/CNPJ nunca vai para endereço), situação e página.
 */

export const PORTAL_PAGE_SIZE = 25;

export interface PortalListQuery {
  search: string;
  /** Casos: rótulo simplificado do parceiro (agrupa várias situações). */
  status: string;
  page: number;
}

export const DEFAULT_PORTAL_QUERY: PortalListQuery = { search: "", status: "", page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const isUrlSafeSearch = (s: string) => !/\d/.test(s);

/** Situações do parceiro (rótulos sem repetição) → situações reais do banco. */
export const PARTNER_STATUS_GROUPS: { label: string; statuses: LegalCaseStatus[] }[] = [...new Set(LEGAL_CASE_STATUSES.map((s) => PARTNER_CASE_STATUS_LABEL[s]))].map(
  (label) => ({ label, statuses: LEGAL_CASE_STATUSES.filter((s) => PARTNER_CASE_STATUS_LABEL[s] === label) }),
);

export function portalQueryFromSearchParams(params: Record<string, string | string[] | undefined>, withStatus = false): PortalListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const status = first(params.situacao);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    search: isUrlSafeSearch(search) ? search : "",
    status: withStatus && PARTNER_STATUS_GROUPS.some((g) => g.label === status) ? status : "",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function portalQueryToSearchParams(q: PortalListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafeSearch(q.search)) p.set("busca", q.search);
  if (q.status) p.set("situacao", q.status);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

const base = (q: PortalListQuery) => ({ q: q.search.trim() || undefined, page: q.page, pageSize: PORTAL_PAGE_SIZE, sortBy: "updatedAt", sortDirection: "desc" });

export const portalClientInput = (q: PortalListQuery) => base(q);
export const portalProcessInput = (q: PortalListQuery) => base(q);

export function portalCaseInput(q: PortalListQuery) {
  const statuses = PARTNER_STATUS_GROUPS.find((g) => g.label === q.status)?.statuses;
  return { ...base(q), status: statuses };
}
