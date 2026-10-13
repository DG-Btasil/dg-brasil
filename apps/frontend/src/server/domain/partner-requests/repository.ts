import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DbPartnerRequestType } from "@/repositories/api/db-mappings";
import type { PartnerRequestStatus } from "@/lib/constants/status";
import type { PartnerRequestMessageRow, PartnerRequestRow } from "./mappers";

/**
 * Acesso a dados de solicitações a parceiro. Sem regra de negócio. A RLS
 * recorta o parceiro ao próprio escritório (partner_requests_select) e o
 * trigger private.partner_requests_guard trava o que o parceiro pode mudar.
 *
 * Inserções sem RETURNING (contrato do banco para escrita de parceiro): o id
 * é gerado no servidor e a leitura, quando necessária, é outra consulta.
 */

const REQUEST_COLUMNS =
  "id, partner_organization_id, legal_case_id, legal_process_id, type, title, description, due_at, status, created_by, created_at, updated_at, answered_at, resolved_at";

export interface RequestFilters {
  status?: PartnerRequestStatus;
  type?: DbPartnerRequestType;
  legalCaseId?: string;
  partnerOrganizationId?: string;
}

export async function list(
  db: SupabaseClient,
  filters: RequestFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: PartnerRequestRow[]; total: number }> {
  let query = db.from("partner_requests").select(REQUEST_COLUMNS, { count: "exact" });
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.partnerOrganizationId) query = query.eq("partner_organization_id", filters.partnerOrganizationId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as PartnerRequestRow[], total: count ?? 0 };
}

export async function getById(db: SupabaseClient, id: string): Promise<PartnerRequestRow | null> {
  return unwrap(await db.from("partner_requests").select(REQUEST_COLUMNS).eq("id", id).maybeSingle()) as PartnerRequestRow | null;
}

export async function listMessages(db: SupabaseClient, requestId: string): Promise<PartnerRequestMessageRow[]> {
  return (unwrap(
    await db
      .from("partner_request_messages")
      .select("id, author_id, body, document_id, created_at")
      .eq("partner_request_id", requestId)
      .order("created_at")
      .order("id")
      .limit(500),
  ) ?? []) as PartnerRequestMessageRow[];
}

/** Quais destes usuários são (ou foram) membros do escritório parceiro. Interno lê todos; parceiro, os do próprio escritório. */
export async function partnerMemberIds(db: SupabaseClient, organizationId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const data = unwrap(
    await db.from("organization_memberships").select("user_id").eq("organization_id", organizationId).in("user_id", userIds),
  ) as { user_id: string }[] | null;
  return new Set((data ?? []).map((m) => m.user_id));
}

/** Nomes dos perfis que o usuário pode ler (RLS de profiles). */
export async function profileNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const data = unwrap(await db.from("profiles").select("id, full_name").in("id", ids)) as { id: string; full_name: string }[] | null;
  return new Map((data ?? []).map((p) => [p.id, p.full_name]));
}

/** Documentos destes ids que o usuário consegue abrir (RLS de documents). */
export async function readableDocumentIds(db: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const data = unwrap(await db.from("documents").select("id").in("id", ids).is("deleted_at", null)) as { id: string }[] | null;
  return new Set((data ?? []).map((d) => d.id));
}

export interface CaseRow {
  id: string;
  client_id: string;
  partner_organization_id: string | null;
  deleted_at: string | null;
}

export async function getCase(db: SupabaseClient, caseId: string): Promise<CaseRow | null> {
  return unwrap(
    await db.from("legal_cases").select("id, client_id, partner_organization_id, deleted_at").eq("id", caseId).maybeSingle(),
  ) as CaseRow | null;
}

export interface DocumentRow {
  id: string;
  client_id: string;
  visibility: "INTERNAL" | "PARTNER_VISIBLE";
  deleted_at: string | null;
}

export async function getDocument(db: SupabaseClient, documentId: string): Promise<DocumentRow | null> {
  return unwrap(
    await db.from("documents").select("id, client_id, visibility, deleted_at").eq("id", documentId).maybeSingle(),
  ) as DocumentRow | null;
}

export async function insert(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("partner_requests").insert(row));
}

export async function insertMessage(db: SupabaseClient, row: { id: string; partner_request_id: string; author_id: string; body: string; document_id: string | null }): Promise<void> {
  unwrap(await db.from("partner_request_messages").insert(row));
}

/**
 * Troca de status condicionada ao status atual (corrida de dois cliques: só
 * um ganha). Devolve quantas linhas mudaram (0 = estado mudou ou sem acesso).
 */
export async function updateStatus(db: SupabaseClient, id: string, to: PartnerRequestStatus, from: PartnerRequestStatus[]): Promise<number> {
  const { error, count } = await db.from("partner_requests").update({ status: to }, { count: "exact" }).eq("id", id).in("status", from);
  if (error) throw fromDbError(error);
  return count ?? 0;
}
