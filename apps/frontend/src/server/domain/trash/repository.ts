import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { TrashRow } from "./mappers";
import type { TrashKind } from "./schemas";

/**
 * Lixeira (migration 066): só RPCs, com o JWT do usuário. O banco confere o
 * ADMIN em cada uma, monta a lista com quem excluiu (auditoria) e recusa a
 * restauração que deixaria dois registros ativos com o mesmo CPF/CNPJ ou CNJ.
 */

const RESTORE_RPC: Record<TrashKind, string> = { CLIENT: "restore_client", PROCESS: "restore_process", DOCUMENT: "restore_document" };

export async function listTrash(db: SupabaseClient, kind: TrashKind, q: string | undefined, page: PageInput): Promise<{ rows: TrashRow[]; total: number }> {
  const { from } = toRange(page);
  const data = unwrap(await db.rpc("trash_list", { p_kind: kind, p_search: q?.trim() || null, p_limit: page.pageSize, p_offset: from })) as {
    total: number;
    items: TrashRow[];
  } | null;
  return { rows: data?.items ?? [], total: Number(data?.total ?? 0) };
}

export async function restore(db: SupabaseClient, kind: TrashKind, id: string): Promise<Record<string, unknown>> {
  return (unwrap(await db.rpc(RESTORE_RPC[kind], { p_id: id })) ?? {}) as Record<string, unknown>;
}
