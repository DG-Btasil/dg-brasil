import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import { IMPORT_JOB_COLUMNS, type ImportJobRow, type ImportRowRow } from "./mappers";

/**
 * Importação (042). Escrita só pelas operações controladas do banco
 * (public.import_*, ADMIN); leitura das tabelas pela RLS de ADMIN (016).
 */

type Json = Record<string, unknown>;
const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> => unwrap(await db.rpc(fn, args)) as T;

export const createJob = (db: SupabaseClient, fileName: string, fileType: string) =>
  rpc<{ import_job_id: string; storage_object_name: string; file_type: "CSV" | "XLSX" }>(db, "import_create_job", { p_file_name: fileName, p_file_type: fileType });

export const authorizeFile = (db: SupabaseClient, jobId: string) =>
  rpc<{ storage_object_name: string; file_type: "CSV" | "XLSX"; sheet_name: string | null; status: string }>(db, "import_authorize_file", { p_job_id: jobId });

export const registerColumns = (db: SupabaseClient, jobId: string, checksum: string, sheetName: string | undefined, columns: string[], totalRows: number) =>
  rpc<{ status: string; same_file_jobs: Json[] }>(db, "import_register_columns", {
    p_job_id: jobId,
    p_checksum: checksum,
    p_sheet_name: sheetName ?? null,
    p_columns: columns,
    p_total_rows: totalRows,
  });

export const failJob = (db: SupabaseClient, jobId: string, message: string) => rpc<null>(db, "import_fail", { p_job_id: jobId, p_message: message });

export const saveMapping = (db: SupabaseClient, jobId: string, mappings: { source_column: string; target_field: string }[], options: Json) =>
  rpc<{ status: string; has_processes: boolean }>(db, "import_save_mapping", { p_job_id: jobId, p_mappings: mappings, p_options: options });

export const stageRows = (db: SupabaseClient, jobId: string, rows: unknown[], reset: boolean) =>
  rpc<number>(db, "import_stage_rows", { p_job_id: jobId, p_rows: rows, p_reset: reset });

export const finishDryRun = (db: SupabaseClient, jobId: string) => rpc<{ status: string; open_conflicts: number }>(db, "import_finish_dry_run", { p_job_id: jobId });

export const resolveConflicts = (db: SupabaseClient, jobId: string, items: Json[]) =>
  rpc<{ status: string; open_conflicts: number }>(db, "import_resolve_conflicts", { p_job_id: jobId, p_items: items });

export const getPlan = (db: SupabaseClient, jobId: string) => rpc<Json>(db, "get_import_plan", { p_job_id: jobId });

export const getConflicts = (db: SupabaseClient, jobId: string, offset: number, limit: number) =>
  rpc<Json>(db, "get_import_conflicts", { p_job_id: jobId, p_offset: offset, p_limit: limit });

export const referenceData = (db: SupabaseClient) => rpc<{ areas: Json[]; users: Json[] }>(db, "get_import_reference_data");

export const confirm = (db: SupabaseClient, jobId: string) => rpc<Json>(db, "import_confirm", { p_job_id: jobId });

export const processBatch = (db: SupabaseClient, jobId: string, limit: number) => rpc<Json>(db, "import_process_batch", { p_job_id: jobId, p_limit: limit });

export const cancel = (db: SupabaseClient, jobId: string) => rpc<null>(db, "import_cancel", { p_job_id: jobId });

export const filesToDelete = (db: SupabaseClient, limit: number) => rpc<{ id: string; storage_object_name: string }[]>(db, "import_files_to_delete", { p_limit: limit });

export const markFileDeleted = (db: SupabaseClient, jobId: string) => rpc<null>(db, "import_mark_file_deleted", { p_job_id: jobId });

export async function getJob(db: SupabaseClient, jobId: string): Promise<ImportJobRow | null> {
  const { data, error } = await db.from("import_jobs").select(IMPORT_JOB_COLUMNS).eq("id", jobId).maybeSingle();
  if (error) throw fromDbError(error);
  return data as ImportJobRow | null;
}

export async function listJobs(db: SupabaseClient, page: PageInput): Promise<{ rows: ImportJobRow[]; total: number }> {
  const { from, to } = toRange(page);
  const { data, error, count } = await db
    .from("import_jobs")
    .select(IMPORT_JOB_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as ImportJobRow[], total: count ?? 0 };
}

export async function getMappings(db: SupabaseClient, jobId: string) {
  return (unwrap(await db.from("import_column_mappings").select("source_column, target_field").eq("import_job_id", jobId).order("created_at")) ?? []) as {
    source_column: string;
    target_field: string;
  }[];
}

const ROW_COLUMNS = "row_number, status, errors, warnings, raw_data, payload, outcome";

export async function listRows(
  db: SupabaseClient,
  jobId: string,
  statuses: string[] | null,
  range: { from: number; to: number },
): Promise<{ rows: ImportRowRow[]; total: number }> {
  let q = db.from("import_row_results").select(ROW_COLUMNS, { count: "exact" }).eq("import_job_id", jobId);
  if (statuses) q = q.in("status", statuses);
  const { data, error, count } = await q.order("row_number").range(range.from, range.to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as ImportRowRow[], total: count ?? 0 };
}

export async function profileNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = (unwrap(await db.from("profiles").select("id, full_name").in("id", unique)) ?? []) as { id: string; full_name: string | null }[];
  return new Map(rows.map((r) => [r.id, r.full_name ?? ""]));
}
