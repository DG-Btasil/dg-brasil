import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DeadlineAgendaRow } from "./mappers";

/**
 * Acesso a dados de Prazos (JWT do usuário; RLS: leitura interna, escrita
 * ADMIN/LAWYER). Toda leitura sai da view `deadline_agenda` (security_invoker,
 * migration 063): a situação efetiva (OVERDUE derivado) vem do banco, junto
 * com cliente, caso e processo. Mudança de situação e conferência passam pelas
 * funções do banco (motivo, trava da linha e auditoria ficam lá).
 */

const AGENDA_COLUMNS =
  "id, legal_case_id, legal_process_id, title, deadline_type, description, due_at, due_date_local, priority, status, effective_status, responsible_user_id, source, created_at, updated_at, completed_at, status_reason, status_changed_at, status_changed_by, checked_at, checked_by, agent_unchecked, hearing_mode, hearing_location, hearing_link, case_title, client_id, client_name, process_title, process_cnj, process_court";

export interface AgendaFilters {
  effectiveStatus?: string;
  /** Status gravado (OPEN inclui os vencidos). */
  status?: string;
  caseId?: string;
  processId?: string;
  responsibleUserId?: string;
  type?: string;
  /** Data local (YYYY-MM-DD) mínima/máxima do vencimento, inclusivas. */
  fromLocalDate?: string;
  untilLocalDate?: string;
  agentUnchecked?: boolean;
}

/** Página da agenda, por instante do vencimento (desempate por id). */
export async function listAgendaPage(
  db: SupabaseClient,
  filters: AgendaFilters,
  page: PageInput,
  ascending: boolean,
): Promise<{ rows: DeadlineAgendaRow[]; total: number }> {
  // Prazo de caso/processo excluído não aparece em nenhuma listagem (migration 026).
  let query = db.from("deadline_agenda").select(AGENDA_COLUMNS, { count: "exact" }).eq("scope_deleted", false);
  if (filters.effectiveStatus) query = query.eq("effective_status", filters.effectiveStatus);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.caseId) query = query.eq("legal_case_id", filters.caseId);
  if (filters.processId) query = query.eq("legal_process_id", filters.processId);
  if (filters.responsibleUserId) query = query.eq("responsible_user_id", filters.responsibleUserId);
  if (filters.type) query = query.eq("deadline_type", filters.type);
  if (filters.fromLocalDate) query = query.gte("due_date_local", filters.fromLocalDate);
  if (filters.untilLocalDate) query = query.lte("due_date_local", filters.untilLocalDate);
  if (filters.agentUnchecked) query = query.eq("agent_unchecked", true);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("due_at", { ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as unknown as DeadlineAgendaRow[], total: count ?? 0 };
}

/** Um prazo. Prazo de caso/processo excluído = não encontrado (coerente com as listagens). */
export async function getOne(db: SupabaseClient, id: string): Promise<DeadlineAgendaRow | null> {
  return unwrap(await db.from("deadline_agenda").select(AGENDA_COLUMNS).eq("id", id).eq("scope_deleted", false).maybeSingle()) as DeadlineAgendaRow | null;
}

/** Status gravado (para decidir se a edição cabe); null = não existe ou sem acesso. */
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

/**
 * Cria o prazo com chave de envio (create_deadline_once, migration 063): a
 * mesma chave com o mesmo pedido devolve o prazo já criado.
 */
export async function createOnce(db: SupabaseClient, key: string, deadline: Record<string, unknown>): Promise<{ deadline_id: string; deduplicated: boolean }> {
  return unwrap(await db.rpc("create_deadline_once", { p_key: key, p_deadline: deadline })) as { deadline_id: string; deduplicated: boolean };
}

/**
 * Altera prazo que AINDA está no status esperado (guarda contra corrida na
 * edição). Nenhuma linha = mudou no meio do caminho.
 */
export async function updateIfStatus(db: SupabaseClient, id: string, expected: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error, count } = await db.from("deadlines").update(patch, { count: "exact" }).eq("id", id).eq("status", expected);
  if (error) throw fromDbError(error);
  return (count ?? 0) > 0;
}

export type DeadlineTransition = "COMPLETE" | "CANCEL" | "MISS" | "REOPEN";

/** Cumprir, cancelar, marcar como perdido ou reabrir (deadline_transition, migration 063). */
export async function transition(db: SupabaseClient, id: string, action: DeadlineTransition, reason?: string): Promise<void> {
  unwrap(await db.rpc("deadline_transition", { p_deadline_id: id, p_action: action, p_reason: reason ?? null }));
}

/** "Conferido" no prazo do agente (deadline_mark_checked, migration 063). */
export async function markChecked(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.rpc("deadline_mark_checked", { p_deadline_id: id }));
}
