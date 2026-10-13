import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { AccessEventRow, AuditEventRow } from "./mappers";

/**
 * Leitura da trilha de auditoria (JWT do usuário; RLS *_select_admin: só
 * ADMIN lê). SOMENTE leitura: não há função de escrita neste módulo, o
 * `authenticated` não tem grant de INSERT/UPDATE nessas tabelas e o trigger
 * append-only recusaria de qualquer forma.
 *
 * Colunas explícitas — `ip_address` e `user_agent` ficam fora (ver dto.ts).
 */

const AUDIT_COLUMNS = "id, actor_type, actor_user_id, actor_organization_id, agent_run_id, action, entity_type, entity_id, request_id, metadata, created_at";
const ACCESS_COLUMNS = "id, actor_type, actor_user_id, organization_id, agent_run_id, client_id, resource_type, resource_id, action, purpose, request_id, created_at";

export interface AuditFilters {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorUserId?: string;
  actorType?: "USER" | "AGENT" | "SYSTEM";
  requestId?: string;
  from?: string;
  to?: string;
}

export async function listAuditEvents(
  db: SupabaseClient,
  filters: AuditFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: AuditEventRow[]; total: number }> {
  let query = db.from("audit_events").select(AUDIT_COLUMNS, { count: "exact" });
  if (filters.entityType) query = query.eq("entity_type", filters.entityType);
  if (filters.entityId) query = query.eq("entity_id", filters.entityId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.actorType) query = query.eq("actor_type", filters.actorType);
  if (filters.requestId) query = query.eq("request_id", filters.requestId);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as AuditEventRow[], total: count ?? 0 };
}

export interface AccessFilters {
  clientId?: string;
  actorUserId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export async function listAccessEvents(
  db: SupabaseClient,
  filters: AccessFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: AccessEventRow[]; total: number }> {
  let query = db.from("personal_data_access_events").select(ACCESS_COLUMNS, { count: "exact" });
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.actorUserId) query = query.eq("actor_user_id", filters.actorUserId);
  if (filters.resourceType) query = query.eq("resource_type", filters.resourceType);
  if (filters.resourceId) query = query.eq("resource_id", filters.resourceId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.from) query = query.gte("created_at", filters.from);
  if (filters.to) query = query.lte("created_at", filters.to);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as AccessEventRow[], total: count ?? 0 };
}

/** Nomes dos atores da página (uma consulta, só id e nome). */
export async function getActorNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = (unwrap(await db.from("profiles").select("id, full_name").in("id", ids)) ?? []) as { id: string; full_name: string }[];
  return new Map(rows.map((r) => [r.id, r.full_name]));
}
