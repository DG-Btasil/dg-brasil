import type { PartnerRequestStatus } from "@/lib/constants/status";

/**
 * Consulta da lista de solicitações (servidor e navegador). Para o parceiro,
 * o escopo vazio já significa "as do meu escritório" (RLS) — o escritório
 * nunca vem do navegador.
 */
export type RequestScope = { legalCaseId: string } | { partnerOrganizationId: string } | Record<string, never>;

export const REQUEST_PAGE_SIZE = 25;

export function requestListInput(scope: RequestScope, q: { status: PartnerRequestStatus | ""; page: number } = { status: "", page: 1 }) {
  return { ...scope, status: q.status || undefined, page: q.page, pageSize: REQUEST_PAGE_SIZE, sortBy: "createdAt", sortDirection: "desc" };
}
