import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap, type DbErrorLike } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DbOrganizationStatus } from "@/repositories/api/db-mappings";
import type { MembershipRow, OrganizationRow, OwnerSettingsRow, PartnerSettingsRow, ProfileRow } from "./mappers";

/**
 * Acesso a dados de organizações (queries com o JWT do usuário). Sem regra de
 * negócio: autorização contextual no service; RLS (organizations_*,
 * partner_office_settings_admin_*, owner_office_settings_*) e triggers
 * (organizations_guard, auditoria) como segunda barreira. Colunas explícitas.
 */

const ORG_COLUMNS = `id, type, name, legal_name, trade_name, cnpj, email, phone, website,
  address_postal_code, address_street, address_number, address_complement, address_neighborhood,
  address_city, address_state, address_country, status, created_at, updated_at`;

const PARTNER_SETTINGS_COLUMNS =
  "organization_id, default_partner_percentage, default_owner_percentage, partnership_active, responsible_name, responsible_oab_number, responsible_oab_state, activated_at, notes";

const OWNER_SETTINGS_COLUMNS = "organization_id, principal_lawyer_name, principal_oab_number, principal_oab_state, states_of_practice, units";

/* ------------------------------------------------------------------ */
/* Erros com mensagem própria                                          */
/* ------------------------------------------------------------------ */

const ORGANIZATION_UNIQUE: Record<string, string> = {
  organizations_cnpj_key: "Já existe um escritório com este CNPJ.",
  // Índice parcial: um único OWNER não excluído. Nenhum caminho daqui cria
  // OWNER, mas a mensagem fica pronta caso o banco recuse.
  organizations_single_owner: "Já existe um escritório proprietário. Não é possível criar outro.",
  partner_office_settings_pkey: "Este parceiro já tem configuração de parceria.",
};

/** Erro do banco → DomainError, com as unicidades de organização traduzidas. */
export function fromOrganizationDbError(error: DbErrorLike | null | undefined): DomainError {
  if (error?.code === "23505") {
    const constraint = /constraint "([^"]+)"/.exec(error.message ?? "")?.[1];
    const message = constraint ? ORGANIZATION_UNIQUE[constraint] : undefined;
    if (message) return new DomainError("CONFLICT", message, { technicalCode: "23505" });
  }
  return fromDbError(error);
}

function check<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw fromOrganizationDbError(result.error);
  return result.data;
}

/** Escapa curingas do ILIKE: o texto do usuário nunca vira padrão. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/* ------------------------------------------------------------------ */
/* Escritório proprietário                                             */
/* ------------------------------------------------------------------ */

export async function getOwnerOrganization(db: SupabaseClient): Promise<OrganizationRow | null> {
  return unwrap(await db.from("organizations").select(ORG_COLUMNS).eq("type", "OWNER").is("deleted_at", null).maybeSingle()) as OrganizationRow | null;
}

export async function getOwnerSettings(db: SupabaseClient, organizationId: string): Promise<OwnerSettingsRow | null> {
  return unwrap(await db.from("owner_office_settings").select(OWNER_SETTINGS_COLUMNS).eq("organization_id", organizationId).maybeSingle()) as OwnerSettingsRow | null;
}

/** Cria a linha se ainda não existe; senão altera só as colunas enviadas. */
export async function upsertOwnerSettings(db: SupabaseClient, organizationId: string, payload: Record<string, unknown>): Promise<void> {
  check(await db.from("owner_office_settings").upsert({ organization_id: organizationId, ...payload }, { onConflict: "organization_id" }));
}

/* ------------------------------------------------------------------ */
/* Organização (as duas)                                               */
/* ------------------------------------------------------------------ */

/** PATCH de colunas cadastrais de uma organização do tipo indicado. Devolve quantas linhas mudou. */
export async function updateOrganization(db: SupabaseClient, id: string, type: "OWNER" | "PARTNER", payload: Record<string, unknown>): Promise<number> {
  const { error, count } = await db.from("organizations").update(payload, { count: "exact" }).eq("id", id).eq("type", type).is("deleted_at", null);
  if (error) throw fromOrganizationDbError(error);
  return count ?? 0;
}

/**
 * Muda a situação. SEM filtro de tipo de propósito: se o id for o OWNER, o
 * trigger organizations_guard recusa com mensagem própria (o service não
 * reimplementa a regra).
 */
export async function setOrganizationStatus(db: SupabaseClient, id: string, status: DbOrganizationStatus): Promise<number> {
  const { error, count } = await db.from("organizations").update({ status }, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (error) throw fromOrganizationDbError(error);
  return count ?? 0;
}

/* ------------------------------------------------------------------ */
/* Parceiros                                                           */
/* ------------------------------------------------------------------ */

export interface PartnerFilters {
  q?: string;
  status?: DbOrganizationStatus;
}

export async function listPartners(
  db: SupabaseClient,
  filters: PartnerFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: OrganizationRow[]; total: number }> {
  let query = db.from("organizations").select(ORG_COLUMNS, { count: "exact" }).eq("type", "PARTNER").is("deleted_at", null);
  const q = filters.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    // Só dígitos (≥ 3): CNPJ por prefixo. Texto: nome ou nome fantasia.
    if (digits.length >= 3 && digits.length === q.replace(/[\s.\-/]/g, "").length) {
      query = query.like("cnpj", `${digits}%`);
    } else {
      const pattern = likePattern(q);
      query = query.or(`name.ilike.${quoteFilter(pattern)},trade_name.ilike.${quoteFilter(pattern)}`);
    }
  }
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as OrganizationRow[], total: count ?? 0 };
}

/**
 * Valor dentro de um filtro `or=(...)` do PostgREST: entre aspas duplas, com
 * aspas e barras escapadas — vírgula, parêntese ou ponto do usuário não viram
 * sintaxe de filtro.
 */
export function quoteFilter(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function getPartnerOrganization(db: SupabaseClient, id: string): Promise<OrganizationRow | null> {
  return unwrap(await db.from("organizations").select(ORG_COLUMNS).eq("id", id).eq("type", "PARTNER").is("deleted_at", null).maybeSingle()) as OrganizationRow | null;
}

/** Divisão e dados internos dos parceiros indicados (RLS: só ADMIN lê). */
export async function getPartnerSettings(db: SupabaseClient, organizationIds: string[]): Promise<PartnerSettingsRow[]> {
  if (organizationIds.length === 0) return [];
  return (unwrap(await db.from("partner_office_settings").select(PARTNER_SETTINGS_COLUMNS).in("organization_id", organizationIds)) ?? []) as PartnerSettingsRow[];
}

/** Insere a organização com id gerado no servidor (sem RETURNING). */
export async function insertOrganization(db: SupabaseClient, payload: Record<string, unknown>): Promise<void> {
  check(await db.from("organizations").insert(payload));
}

export async function insertPartnerSettings(db: SupabaseClient, payload: Record<string, unknown>): Promise<void> {
  check(await db.from("partner_office_settings").insert(payload));
}

export async function updatePartnerSettings(db: SupabaseClient, organizationId: string, payload: Record<string, unknown>): Promise<number> {
  const { error, count } = await db.from("partner_office_settings").update(payload, { count: "exact" }).eq("organization_id", organizationId);
  if (error) throw fromOrganizationDbError(error);
  return count ?? 0;
}

/** Compensação do cadastro em duas etapas: exclusão lógica do parceiro recém-criado. */
export async function softDeleteOrganization(db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from("organizations").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("type", "PARTNER");
  if (error) throw fromOrganizationDbError(error);
}

/* ------------------------------------------------------------------ */
/* Usuários (leitura)                                                  */
/* ------------------------------------------------------------------ */

export async function listMemberships(
  db: SupabaseClient,
  organizationId: string,
  filters: { status: MembershipRow["status"]; role?: string },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: MembershipRow[]; total: number }> {
  let query = db
    .from("organization_memberships")
    .select("id, organization_id, user_id, role, status, joined_at, created_at", { count: "exact" })
    .eq("organization_id", organizationId)
    .eq("status", filters.status);
  if (filters.role) query = query.eq("role", filters.role);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as MembershipRow[], total: count ?? 0 };
}

export async function getProfiles(db: SupabaseClient, ids: string[]): Promise<ProfileRow[]> {
  if (ids.length === 0) return [];
  return (unwrap(await db.from("profiles").select("id, full_name, preferred_name, job_title, oab_number, oab_state, active").in("id", ids)) ?? []) as ProfileRow[];
}
