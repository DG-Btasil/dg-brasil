import { AGREEMENT_DB_STATUSES } from "@/server/domain/finance/schemas";
import type { AgreementDbStatus } from "@/server/domain/finance/dto";

/** Lista de acordos ↔ URL ↔ entrada de `listAgreementRowsAction`. Sem dado pessoal na URL. */

export interface AgreementListQuery {
  status: AgreementDbStatus | "";
  page: number;
}

export const AGREEMENT_PAGE_SIZE = 25;
export const DEFAULT_AGREEMENT_QUERY: AgreementListQuery = { status: "", page: 1 };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function agreementQueryFromSearchParams(params: Record<string, string | string[] | undefined>): AgreementListQuery {
  const status = first(params.situacao);
  const page = Number.parseInt(first(params.pagina), 10);
  return {
    status: (AGREEMENT_DB_STATUSES as readonly string[]).includes(status) ? (status as AgreementDbStatus) : "",
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

export function agreementQueryToSearchParams(q: AgreementListQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.status) p.set("situacao", q.status);
  if (q.page > 1) p.set("pagina", String(q.page));
  return p;
}

export function agreementQueryToInput(q: AgreementListQuery, scope: { legalCaseId?: string } = {}): Record<string, unknown> {
  return { ...scope, status: q.status || undefined, page: q.page, pageSize: AGREEMENT_PAGE_SIZE, sortBy: "createdAt", sortDirection: "desc" };
}
