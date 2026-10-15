import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { NotificationRow } from "./mappers";
import type { NotificationOrder } from "./schemas";

/**
 * Notificações do usuário (JWT do próprio usuário). Toda consulta filtra
 * `user_id` explicitamente (índice notifications_user_read_created_idx) E a
 * RLS (notifications_*_own, com aal2) repete o filtro no banco. A única
 * coluna gravável pelo usuário é `read_at` (grant de coluna).
 */

const COLUMNS = "id, type, title, message, severity, legal_case_id, legal_process_id, partner_request_id, related_type, related_id, read_at, created_at";

export async function list(
  db: SupabaseClient,
  userId: string,
  filters: { unreadOnly: boolean; order: NotificationOrder },
  page: PageInput,
): Promise<{ rows: NotificationRow[]; total: number }> {
  let query = db.from("notifications").select(COLUMNS, { count: "exact" }).eq("user_id", userId);
  if (filters.unreadOnly) query = query.is("read_at", null);
  // Não lidas primeiro: read_at nulo no topo (as não lidas por data); as lidas
  // em seguida, pela leitura mais recente.
  if (filters.order === "UNREAD_FIRST") query = query.order("read_at", { ascending: false, nullsFirst: true });
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as NotificationRow[], total: count ?? 0 };
}

export async function countUnread(db: SupabaseClient, userId: string): Promise<number> {
  const { error, count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

/** Existe para este usuário (e ele enxerga)? Só para distinguir "já lida" de "não encontrada". */
export async function exists(db: SupabaseClient, userId: string, id: string): Promise<boolean> {
  return unwrap(await db.from("notifications").select("id").eq("id", id).eq("user_id", userId).maybeSingle()) !== null;
}

/** Marca uma como lida (só se ainda não lida). Devolve quantas mudaram (0 ou 1). */
export async function markRead(db: SupabaseClient, userId: string, id: string, at: string): Promise<number> {
  const { error, count } = await db.from("notifications").update({ read_at: at }, { count: "exact" }).eq("id", id).eq("user_id", userId).is("read_at", null);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

export async function markAllRead(db: SupabaseClient, userId: string, at: string): Promise<number> {
  const { error, count } = await db.from("notifications").update({ read_at: at }, { count: "exact" }).eq("user_id", userId).is("read_at", null);
  if (error) throw fromDbError(error);
  return count ?? 0;
}
