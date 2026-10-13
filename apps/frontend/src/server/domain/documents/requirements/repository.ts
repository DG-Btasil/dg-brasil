import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { RequirementRow } from "./mappers";
import type { RequirementStatus } from "./schemas";

/**
 * Acesso a `case_document_requirements`. Escrita só da equipe interna (RLS);
 * parceiro lê as dos próprios casos. O trigger da 007 confere que a versão
 * que atende é de documento do MESMO cliente e vinculado ao caso.
 */

const COLUMNS =
  "id, legal_case_id, requirement_label, category, required, status, satisfied_by_document_version_id, requested_at, satisfied_at, created_at, updated_at";

export async function listByCase(
  db: SupabaseClient,
  legalCaseId: string,
  filters: { status?: RequirementStatus },
  page: PageInput,
): Promise<{ rows: RequirementRow[]; total: number }> {
  let query = db.from("case_document_requirements").select(COLUMNS, { count: "exact" }).eq("legal_case_id", legalCaseId);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("created_at").order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as RequirementRow[], total: count ?? 0 };
}

export async function getById(db: SupabaseClient, id: string): Promise<RequirementRow | null> {
  return unwrap(await db.from("case_document_requirements").select(COLUMNS).eq("id", id).maybeSingle()) as RequirementRow | null;
}

export async function insert(
  db: SupabaseClient,
  row: { legal_case_id: string; requirement_label: string; category: string; required: boolean; status: "MISSING" | "REQUESTED" },
): Promise<RequirementRow> {
  return unwrap(await db.from("case_document_requirements").insert(row).select(COLUMNS).single()) as RequirementRow;
}

/**
 * Transição com concorrência otimista: só atualiza se o status ainda é um dos
 * esperados. Devolve a linha nova, ou null se ninguém foi atualizado.
 */
export async function transition(
  db: SupabaseClient,
  id: string,
  from: readonly RequirementStatus[],
  patch: Record<string, unknown>,
): Promise<RequirementRow | null> {
  const { data, error } = await db.from("case_document_requirements").update(patch).eq("id", id).in("status", [...from]).select(COLUMNS);
  if (error) throw fromDbError(error);
  return ((data ?? []) as RequirementRow[])[0] ?? null;
}
