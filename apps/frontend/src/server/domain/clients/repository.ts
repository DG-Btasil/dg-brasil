import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { ClientDetailRow, ClientDirectoryRow, ClientInternalRow, RelationshipRow } from "./mappers";

/**
 * SupabaseClientRepository: só acesso a dados (queries, RPCs). Sem regra de
 * negócio — autorização contextual e invariantes ficam no service; a RLS e as
 * funções do banco são a segunda barreira. Colunas sempre explícitas.
 */

const DIRECTORY_COLUMNS = "id, kind, display_name, trade_name, cpf, cnpj, status, origin_organization_id, responsible_user_id, created_at, updated_at";

const BASIC_COLUMNS = `id, kind, cpf, cnpj, status, origin_organization_id, responsible_user_id, created_at, updated_at,
  individual_client_details(full_name, social_name, birth_date, gender, nationality, birthplace, marital_status, stable_union, profession,
    identity_document_type, identity_document_number, identity_document_issuer, identity_document_state),
  company_client_details(legal_name, trade_name, registration_status, opening_date, legal_nature, main_cnae, secondary_cnaes),
  client_contacts(type, value, is_primary),
  client_addresses(postal_code, street, number, complement, neighborhood, city, state, country, is_primary)`;

/** Representantes e sócios só para a equipe interna (parceiro não precisa deles). */
const INTERNAL_COLUMNS = `${BASIC_COLUMNS},
  company_representatives(id, full_name, cpf, role_title, email, phone, primary_representative),
  company_shareholders(id, name, document_number, qualification, share_percentage)`;

/** Escapa curingas do ILIKE: o texto do usuário nunca vira padrão. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface DirectoryFilters {
  q?: string;
  status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  kind?: "INDIVIDUAL" | "COMPANY";
  originOrganizationId?: string;
  responsibleUserId?: string;
}

export async function listDirectory(
  db: SupabaseClient,
  filters: DirectoryFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: ClientDirectoryRow[]; total: number }> {
  let query = db.from("client_directory").select(DIRECTORY_COLUMNS, { count: "exact" }).is("deleted_at", null);
  const q = filters.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    // Só dígitos (≥ 3): busca por CPF/CNPJ (prefixo). Texto: busca por nome.
    if (digits.length >= 3 && digits.length === q.replace(/[\s.\-/]/g, "").length) {
      query = query.or(`cpf.like.${digits}%,cnpj.like.${digits}%`);
    } else {
      query = query.ilike("display_name", likePattern(q));
    }
  }
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.originOrganizationId) query = query.eq("origin_organization_id", filters.originOrganizationId);
  if (filters.responsibleUserId) query = query.eq("responsible_user_id", filters.responsibleUserId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as ClientDirectoryRow[], total: count ?? 0 };
}

/**
 * Página de clientes com relacionamento ATIVO com a organização: primeiro a
 * página de relacionamentos, depois as linhas do diretório desses clientes
 * (no máximo `pageSize` ids). RLS de quem pergunta nas duas consultas.
 */
export async function listRelatedDirectory(db: SupabaseClient, organizationId: string, page: PageInput): Promise<{ rows: ClientDirectoryRow[]; total: number }> {
  const { from, to } = toRange(page);
  const rel = await db
    .from("client_organization_relationships")
    .select("client_id", { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .order("client_id")
    .range(from, to);
  if (rel.error) throw fromDbError(rel.error);
  const ids = ((rel.data ?? []) as { client_id: string }[]).map((r) => r.client_id);
  if (ids.length === 0) return { rows: [], total: rel.count ?? 0 };
  const { data, error } = await db.from("client_directory").select(DIRECTORY_COLUMNS).in("id", ids).is("deleted_at", null);
  if (error) throw fromDbError(error);
  const byId = new Map(((data ?? []) as ClientDirectoryRow[]).map((r) => [r.id, r]));
  return { rows: ids.map((id) => byId.get(id)).filter((r): r is ClientDirectoryRow => !!r), total: rel.count ?? 0 };
}

export async function getDetail(db: SupabaseClient, id: string, scope: "INTERNAL" | "PARTNER"): Promise<ClientDetailRow | null> {
  const { data, error } = await db
    .from("clients")
    .select(scope === "INTERNAL" ? INTERNAL_COLUMNS : BASIC_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data as unknown as ClientDetailRow | null;
}

export async function getInternalDetails(db: SupabaseClient, id: string): Promise<ClientInternalRow | null> {
  return unwrap(
    await db
      .from("client_internal_details")
      .select("notes, legal_summary, inactivation_reason, inactivation_note, inactivated_at, inactivated_by")
      .eq("client_id", id)
      .maybeSingle(),
  ) as ClientInternalRow | null;
}

export async function listRelationships(db: SupabaseClient, clientId: string): Promise<RelationshipRow[]> {
  return (unwrap(
    await db.from("client_organization_relationships").select("organization_id, status, created_at, ended_at").eq("client_id", clientId).order("created_at"),
  ) ?? []) as RelationshipRow[];
}

/** Interno: id do cliente por CPF/CNPJ (inclui excluído: excluído é restaurado, não recriado). */
export async function findIdByDocument(db: SupabaseClient, digits: string): Promise<{ id: string; deleted: boolean } | null> {
  const column = digits.length === 11 ? "cpf" : "cnpj";
  const data = unwrap(await db.from("clients").select("id, deleted_at").eq(column, digits).maybeSingle()) as { id: string; deleted_at: string | null } | null;
  return data ? { id: data.id, deleted: data.deleted_at !== null } : null;
}

export async function partnerLookup(db: SupabaseClient, digits: string): Promise<{ status: "NOT_FOUND" | "ALREADY_RELATED" | "EXISTS"; client_id?: string }> {
  return unwrap(await db.rpc("partner_lookup_client", { p_document: digits })) as { status: "NOT_FOUND" | "ALREADY_RELATED" | "EXISTS"; client_id?: string };
}

/** Cria (id null) ou altera (PATCH) numa transação — private.save_client. */
export async function save(db: SupabaseClient, id: string | null, payload: Record<string, unknown>): Promise<string> {
  return unwrap(await db.rpc("save_client", { p_id: id, p: payload })) as string;
}

/** Bloco societário de PJ: substituição atômica (private.replace_company_people, 028). */
export async function replaceCompanyPeople(db: SupabaseClient, clientId: string, payload: { representatives: Record<string, unknown>[]; shareholders: Record<string, unknown>[] }): Promise<CompanyPeopleCounts> {
  return unwrap(
    await db.rpc("replace_company_people", { p_client_id: clientId, p_representatives: payload.representatives, p_shareholders: payload.shareholders }),
  ) as CompanyPeopleCounts;
}

export interface CompanyPeopleCounts {
  representatives: { added: number; updated: number; removed: number };
  shareholders: { added: number; updated: number; removed: number };
}

export async function setStatus(db: SupabaseClient, id: string, status: "ACTIVE" | "INACTIVE", reason?: string, note?: string): Promise<void> {
  unwrap(await db.rpc("set_client_status", { p_id: id, p_status: status, p_reason: reason ?? null, p_note: note ?? null }));
}

/** Exclusão lógica (o banco só permite a ADMIN). */
export async function softDelete(db: SupabaseClient, id: string): Promise<void> {
  const { error, count } = await db.from("clients").update({ deleted_at: new Date().toISOString() }, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (error) throw fromDbError(error);
  if (!count) throw fromDbError({ code: "PGRST116" });
}

/** Processos ainda ligados ao cliente (a exclusão não os apaga). */
export async function listLinkedProcessIds(db: SupabaseClient, clientId: string): Promise<string[]> {
  const data = unwrap(await db.from("legal_processes").select("id, legal_cases!inner(client_id)").eq("legal_cases.client_id", clientId).is("deleted_at", null)) as { id: string }[] | null;
  return (data ?? []).map((p) => p.id);
}

/** LGPD: abertura da ficha (o banco agrupa aberturas repetidas em 10 min). */
export async function recordDetailAccess(db: SupabaseClient, clientId: string): Promise<void> {
  unwrap(await db.rpc("record_personal_data_access", { p_client_id: clientId, p_resource_type: "CLIENT", p_resource_id: clientId, p_action: "VIEW_DETAIL", p_purpose: null }));
}

/**
 * Contagens do portal por cliente (036), uma consulta para a página: casos,
 * processos, solicitações abertas e documentos pedidos — só no escopo do
 * escritório do parceiro (o banco decide; cliente fora da carteira não volta).
 */
export async function partnerClientCounts(db: SupabaseClient, clientIds: string[]): Promise<Map<string, { cases: number; processes: number; openRequests: number; requestedDocuments: number }>> {
  if (clientIds.length === 0) return new Map();
  const rows = (unwrap(await db.rpc("get_partner_client_counts", { p_client_ids: clientIds.slice(0, 100) })) ?? []) as {
    client_id: string;
    case_count: number;
    process_count: number;
    open_request_count: number;
    requested_document_count: number;
  }[];
  return new Map(
    rows.map((r) => [r.client_id, { cases: Number(r.case_count), processes: Number(r.process_count), openRequests: Number(r.open_request_count), requestedDocuments: Number(r.requested_document_count) }]),
  );
}
