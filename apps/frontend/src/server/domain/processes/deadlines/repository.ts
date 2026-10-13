import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DeadlineRow, DeadlineStatusRow } from "./mappers";

/**
 * Acesso a dados de Prazos (JWT do usuário; RLS: leitura interna, escrita
 * ADMIN/LAWYER). A situação efetiva (OVERDUE derivado) vem SEMPRE da view
 * `deadline_status` (security_invoker) — nunca é calculada e gravada aqui.
 */

const DEADLINE_COLUMNS =
  "id, legal_case_id, legal_process_id, title, deadline_type, description, due_at, priority, status, responsible_user_id, source, created_at, updated_at, completed_at";
const STATUS_COLUMNS = "deadline_id, effective_status, due_date_local";

export interface StatusFilters {
  effectiveStatus?: string;
  caseId?: string;
  processId?: string;
  responsibleUserId?: string;
  /** Data local (YYYY-MM-DD) mínima/máxima do vencimento, inclusivas. */
  fromLocalDate?: string;
  untilLocalDate?: string;
}

/** Página da view deadline_status (ordem por data local; desempate por id). */
export async function listStatusPage(
  db: SupabaseClient,
  filters: StatusFilters,
  page: PageInput,
  ascending: boolean,
): Promise<{ rows: DeadlineStatusRow[]; total: number }> {
  // Prazo de caso/processo excluído não aparece em nenhuma listagem (migration 026).
  let query = db.from("deadline_status").select(STATUS_COLUMNS, { count: "exact" }).eq("scope_deleted", false);
  if (filters.effectiveStatus) query = query.eq("effective_status", filters.effectiveStatus);
  if (filters.caseId) query = query.eq("legal_case_id", filters.caseId);
  if (filters.processId) query = query.eq("legal_process_id", filters.processId);
  if (filters.responsibleUserId) query = query.eq("responsible_user_id", filters.responsibleUserId);
  if (filters.fromLocalDate) query = query.gte("due_date_local", filters.fromLocalDate);
  if (filters.untilLocalDate) query = query.lte("due_date_local", filters.untilLocalDate);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("due_date_local", { ascending }).order("deadline_id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as DeadlineStatusRow[], total: count ?? 0 };
}

export async function getByIds(db: SupabaseClient, ids: string[]): Promise<DeadlineRow[]> {
  if (ids.length === 0) return [];
  return (unwrap(await db.from("deadlines").select(DEADLINE_COLUMNS).in("id", ids)) ?? []) as DeadlineRow[];
}

export async function getOne(db: SupabaseClient, id: string): Promise<{ row: DeadlineRow; status: DeadlineStatusRow } | null> {
  const row = unwrap(await db.from("deadlines").select(DEADLINE_COLUMNS).eq("id", id).maybeSingle()) as DeadlineRow | null;
  if (!row) return null;
  // Prazo de caso/processo excluído = não encontrado (coerente com as listagens).
  const status = unwrap(await db.from("deadline_status").select(STATUS_COLUMNS).eq("deadline_id", id).eq("scope_deleted", false).maybeSingle()) as DeadlineStatusRow | null;
  return status ? { row, status } : null;
}

/** Status gravado (para decidir transição); null = não existe ou sem acesso. */
export async function getStoredStatus(db: SupabaseClient, id: string): Promise<string | null> {
  const data = unwrap(await db.from("deadlines").select("status").eq("id", id).maybeSingle()) as { status: string } | null;
  return data?.status ?? null;
}

/** Processo não excluído do caso informado (a FK composta também confere). */
export async function processBelongsToCase(db: SupabaseClient, processId: string, caseId: string): Promise<boolean> {
  const data = unwrap(
    await db.from("legal_processes").select("id").eq("id", processId).eq("legal_case_id", caseId).is("deleted_at", null).maybeSingle(),
  ) as { id: string } | null;
  return data !== null;
}

/** Caso visível e não excluído. */
export async function caseVisible(db: SupabaseClient, caseId: string): Promise<boolean> {
  const data = unwrap(await db.from("legal_cases").select("id").eq("id", caseId).is("deleted_at", null).maybeSingle()) as { id: string } | null;
  return data !== null;
}

/** Inserção sem RETURNING (id gerado no servidor). */
export async function insert(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("deadlines").insert(row));
}

/**
 * Altera prazo que AINDA está no status esperado (guarda contra corrida:
 * dois cliques em "cumprir"). Nenhuma linha = mudou no meio do caminho.
 */
export async function updateIfStatus(db: SupabaseClient, id: string, expected: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error, count } = await db.from("deadlines").update(patch, { count: "exact" }).eq("id", id).eq("status", expected);
  if (error) throw fromDbError(error);
  return (count ?? 0) > 0;
}
