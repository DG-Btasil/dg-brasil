import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, type DbErrorLike } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { CaseInternalRow, CaseListRow, CasePartnerRow, CaseRow, CaseStateRow } from "./mappers";

/**
 * SupabaseCaseRepository: só acesso a dados (queries, RPCs). Sem regra de
 * negócio — autorização contextual fica no service; a RLS, os triggers
 * (máquina de estados, advogado, origem, snapshot de parceria) e as funções
 * do banco são a segunda barreira. Colunas sempre explícitas.
 */

/* ------------------------------------------------------------------ */
/* Colunas                                                             */
/* ------------------------------------------------------------------ */

// Dicas de FK explícitas: legal_cases tem várias FKs (organizações, perfis),
// e a de case_types é composta (tipo + área).
const CATALOG_EMBEDS = `legal_areas!legal_cases_legal_area_id_fkey(code, name),
  case_types!legal_cases_case_type_fkey(code, name)`;

/** O que o parceiro recebe: sem autoria (created_by*), sem advogado responsável. */
const PARTNER_COLUMNS = `id, client_id, legal_area_id, case_type_id, title, summary, opposing_party, status,
  partner_organization_id, origin_organization_id, partner_notes,
  submitted_at, accepted_at, rejected_at, closed_at, archived_at, rejection_reason_public,
  created_at, updated_at, ${CATALOG_EMBEDS}`;

const INTERNAL_COLUMNS = `${PARTNER_COLUMNS}, created_by_organization_id, created_by, assigned_lawyer_id`;

const LIST_BASE_COLUMNS = `id, client_id, legal_area_id, case_type_id, title, status, origin_organization_id, partner_organization_id,
  submitted_at, accepted_at, created_at, updated_at, ${CATALOG_EMBEDS},
  clients!legal_cases_client_id_fkey(individual_client_details(full_name), company_client_details(legal_name))`;

const LIST_INTERNAL_COLUMNS = `${LIST_BASE_COLUMNS}, assigned_lawyer_id`;

const STATE_COLUMNS = "id, status, legal_area_id, partner_organization_id, origin_organization_id, accepted_at";

/* ------------------------------------------------------------------ */
/* Erros do banco específicos do caso                                  */
/* ------------------------------------------------------------------ */

const LAWYER_REQUIRED = "Defina o advogado responsável para aceitar o caso.";
const LAWYER_INVALID = "O advogado responsável precisa ser usuário interno ativo (Administrador ou Advogado).";

/**
 * Traduz as recusas do banco que conhecemos para mensagens de domínio; o
 * resto segue o mapeamento central (fromDbError). Não reimplementa a regra:
 * só dá nome ao que o banco já recusou.
 */
export function caseDbError(error: DbErrorLike): DomainError {
  const code = error.code ?? "";
  const message = error.message ?? "";
  if (code === "23514") {
    if (message.includes("legal_cases_accepted_requires_lawyer")) {
      return new DomainError("VALIDATION", LAWYER_REQUIRED, { fieldErrors: { lawyerId: [LAWYER_REQUIRED] }, technicalCode: code });
    }
    if (message.includes("legal_cases_rejected_requires_reason")) {
      const msg = "Informe o motivo que o parceiro verá.";
      return new DomainError("VALIDATION", msg, { fieldErrors: { publicReason: [msg] }, technicalCode: code });
    }
    if (message.startsWith("O advogado responsável precisa ser")) {
      return new DomainError("VALIDATION", LAWYER_INVALID, { fieldErrors: { lawyerId: [LAWYER_INVALID] }, technicalCode: code });
    }
    if (message.startsWith("Transição de caso inválida")) {
      return new DomainError("INVALID_STATE", "Esta mudança de situação não é permitida no estado atual do caso.", { technicalCode: code });
    }
    if (message.startsWith("Exceção de status não prevista")) {
      return new DomainError("INVALID_STATE", "Esta exceção de situação não é permitida para o caso.", { technicalCode: code });
    }
  }
  // "Caso <uuid> não existe" (change_case_origin / override_case_status).
  if (code === "23503" && /^Caso \S+ não existe$/.test(message)) {
    return new DomainError("NOT_FOUND", "Caso não encontrado.", { technicalCode: code });
  }
  return fromDbError(error);
}

function unwrapCase<T>(result: { data: T; error: DbErrorLike | null }): T {
  if (result.error) throw caseDbError(result.error);
  return result.data;
}

/** Escapa curingas do ILIKE: o texto do usuário nunca vira padrão. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export interface CaseFilters {
  q?: string;
  status?: string[];
  clientId?: string;
  assignedLawyerId?: string;
  partnerOrganizationId?: string;
}

export async function listCases(
  db: SupabaseClient,
  scope: "INTERNAL" | "PARTNER",
  filters: CaseFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: CaseListRow[]; total: number }> {
  let query = db
    .from("legal_cases")
    .select(scope === "INTERNAL" ? LIST_INTERNAL_COLUMNS : LIST_BASE_COLUMNS, { count: "exact" })
    .is("deleted_at", null);
  const q = filters.q?.trim();
  if (q) query = query.ilike("title", likePattern(q));
  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.assignedLawyerId) query = query.eq("assigned_lawyer_id", filters.assignedLawyerId);
  if (filters.partnerOrganizationId) query = query.eq("partner_organization_id", filters.partnerOrganizationId);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw caseDbError(error);
  return { rows: (data ?? []) as unknown as CaseListRow[], total: count ?? 0 };
}

export async function getCase(db: SupabaseClient, id: string, scope: "INTERNAL"): Promise<CaseRow | null>;
export async function getCase(db: SupabaseClient, id: string, scope: "PARTNER"): Promise<CasePartnerRow | null>;
export async function getCase(db: SupabaseClient, id: string, scope: "INTERNAL" | "PARTNER"): Promise<CaseRow | CasePartnerRow | null> {
  const { data, error } = await db
    .from("legal_cases")
    .select(scope === "INTERNAL" ? INTERNAL_COLUMNS : PARTNER_COLUMNS)
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw caseDbError(error);
  return data as unknown as CaseRow | CasePartnerRow | null;
}

/** Dados internos do caso. Só chamar para a equipe interna (a RLS também barra parceiro). */
export async function getInternalDetails(db: SupabaseClient, id: string): Promise<CaseInternalRow | null> {
  return unwrapCase(
    await db.from("legal_case_internal_details").select("rejection_reason_internal, internal_notes, accepted_by").eq("legal_case_id", id).maybeSingle(),
  ) as CaseInternalRow | null;
}

/** Estado mínimo (existência + status + vínculos), com a visibilidade de quem pergunta. */
export async function getCaseState(db: SupabaseClient, id: string): Promise<CaseStateRow | null> {
  return unwrapCase(await db.from("legal_cases").select(STATE_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle()) as CaseStateRow | null;
}

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

export async function findAreaIdByCode(db: SupabaseClient, code: string): Promise<string | null> {
  const data = unwrapCase(await db.from("legal_areas").select("id").eq("code", code).eq("active", true).maybeSingle()) as { id: string } | null;
  return data?.id ?? null;
}

export async function findCaseTypeIdByCode(db: SupabaseClient, legalAreaId: string, code: string): Promise<string | null> {
  const data = unwrapCase(
    await db.from("case_types").select("id").eq("legal_area_id", legalAreaId).eq("code", code).eq("active", true).maybeSingle(),
  ) as { id: string } | null;
  return data?.id ?? null;
}

/** Escritório proprietário (o parceiro também o enxerga, pela RLS de organizations). */
export async function ownerOrganizationId(db: SupabaseClient): Promise<string> {
  const data = unwrapCase(await db.from("organizations").select("id").eq("type", "OWNER").is("deleted_at", null).maybeSingle()) as { id: string } | null;
  if (!data) throw new DomainError("INTERNAL");
  return data.id;
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

/** Inserção interna, sem RETURNING (o id vem do servidor). */
export async function insertCase(db: SupabaseClient, payload: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("legal_cases").insert(payload);
  if (error) throw caseDbError(error);
}

/**
 * UPDATE de colunas do caso. Devolve quantas linhas mudaram: 0 = não existe,
 * não é visível ou a RLS de UPDATE não alcança a linha (o service explica).
 * `exceptStatus`: não toca o caso que JÁ está nesse status (aceite/rejeição
 * idempotentes — o segundo clique não regrava advogado nem motivo).
 */
export async function updateCase(db: SupabaseClient, id: string, payload: Record<string, unknown>, options: { exceptStatus?: string } = {}): Promise<number> {
  let query = db.from("legal_cases").update(payload, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (options.exceptStatus) query = query.neq("status", options.exceptStatus);
  const { error, count } = await query;
  if (error) throw caseDbError(error);
  return count ?? 0;
}

/**
 * Dados internos (upsert por legal_case_id): só as colunas informadas mudam;
 * `accepted_by` (gravado pelo trigger do aceite) nunca é tocado aqui.
 */
export async function upsertInternalDetails(
  db: SupabaseClient,
  id: string,
  fields: { rejection_reason_internal?: string | null; internal_notes?: string | null },
): Promise<void> {
  const { error } = await db.from("legal_case_internal_details").upsert({ legal_case_id: id, ...fields }, { onConflict: "legal_case_id" });
  if (error) throw caseDbError(error);
}

/** Portal do Parceiro: cliente canônico + caso SUBMITTED numa transação (025). */
export async function partnerSubmit(
  db: SupabaseClient,
  payload: { p_client: Record<string, unknown>; p_case: Record<string, unknown> },
): Promise<{ client_id: string; legal_case_id: string; client_existed: boolean }> {
  return unwrapCase(await db.rpc("partner_submit_case", payload)) as { client_id: string; legal_case_id: string; client_existed: boolean };
}

/** Troca de origem comercial (006): antes do aceite, equipe interna; depois, só ADMIN com motivo. */
export async function changeOrigin(db: SupabaseClient, id: string, originOrganizationId: string, reason: string | null): Promise<void> {
  unwrapCase(await db.rpc("change_case_origin", { p_case_id: id, p_new_origin: originOrganizationId, p_reason: reason }));
}

/** Exceção de status (006): ADMIN, motivo obrigatório, auditada. */
export async function overrideStatus(db: SupabaseClient, id: string, status: string, reason: string): Promise<void> {
  unwrapCase(await db.rpc("override_case_status", { p_case_id: id, p_new_status: status, p_reason: reason }));
}
