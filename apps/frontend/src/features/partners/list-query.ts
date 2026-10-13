import { PARTNER_OFFICE_STATUSES, type PartnerOfficeStatus } from "@/lib/constants/status";

/** Estado da lista de parceiros ↔ URL ↔ entrada de `listPartnersAction`. CNPJ digitado não vai para a URL. */

export interface PartnerListQuery {
  search: string;
  status: PartnerOfficeStatus | "";
  sort: "name" | "status" | "createdAt";
  direction: "asc" | "desc";
  page: number;
}

export const PARTNER_PAGE_SIZE = 25;
export const DEFAULT_PARTNER_QUERY: PartnerListQuery = { search: "", status: "", sort: "name", direction: "asc", page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const isUrlSafe = (s: string) => !/\d/.test(s);
const SORTS = ["name", "status", "createdAt"] as const;

export function partnerQueryFromSearchParams(params: Record<string, string | string[] | undefined>): PartnerListQuery {
  const search = first(params.busca).trim().slice(0, 120);
  const status = first(params.situacao);
  const sort = (SORTS as readonly string[]).includes(first(params.ordem)) ? (first(params.ordem) as PartnerListQuery["sort"]) : "name";
  const dir = first(params.dir);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    search: isUrlSafe(search) ? search : "",
    status: (PARTNER_OFFICE_STATUSES as readonly string[]).includes(status) ? (status as PartnerOfficeStatus) : "",
    sort,
    direction: dir === "asc" || dir === "desc" ? dir : sort === "name" ? "asc" : "desc",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function partnerQueryToSearchParams(q: PartnerListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.search && isUrlSafe(q.search)) p.set("busca", q.search);
  if (q.status) p.set("situacao", q.status);
  if (q.sort !== "name" || q.direction !== "asc") {
    p.set("ordem", q.sort);
    p.set("dir", q.direction);
  }
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function partnerQueryToInput(q: PartnerListQuery): Record<string, unknown> {
  return { q: q.search || undefined, status: q.status || undefined, sortBy: q.sort, sortDirection: q.direction, page: q.page, pageSize: PARTNER_PAGE_SIZE };
}
