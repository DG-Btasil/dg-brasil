import "server-only";

import { createHash } from "node:crypto";
import { suggestMapping } from "@/lib/domain/import-fields";
import { requirePermission, type ServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { toPage, type Page, type PageInput } from "@/server/core/pagination";
import type {
  ColumnsDTO,
  ImportBatchDTO,
  ImportConflictsDTO,
  ImportJobDTO,
  ImportJobStatus,
  ImportJobSummaryDTO,
  ImportReferenceDTO,
  ImportReportDTO,
  ImportRowDTO,
  SameFileJobDTO,
  StartedImportDTO,
} from "./dto";
import { buildReportCsv, rowColumns, toBatch, toConflicts, toJobSummary, toMapping, toOptions, toPlan, toRow } from "./mappers";
import { normalizeRows, type ImportUser } from "./normalize";
import { ImportFileError, readSpreadsheet, type ReadResult } from "./parse";
import * as repo from "./repository";
import type { ResolveConflictsInput, SimulateInput, StartImportInput } from "./schemas";
import { IMPORT_CONTENT_TYPE, IMPORTS_BUCKET, importObjectName, MAX_IMPORT_FILE_BYTES, signedImportStorage, type ImportFileType, type ImportStorage } from "./storage";

/**
 * Importação de planilhas (Etapa 7, migration 042). Só ADMIN
 * (`imports.manage`); o banco confere de novo em cada operação.
 *
 *   start      → job + URL assinada de upload (o navegador envia o arquivo)
 *   columns    → o servidor lê o arquivo do Storage, devolve cabeçalho e prévia
 *   simulate   → salva o mapeamento, valida cada linha, o banco confronta com o
 *                que existe e abre conflitos. NADA é gravado em cliente/processo.
 *   resolve    → decisões dos conflitos
 *   confirm    → trava a importação (autor e hora)
 *   process    → grava um lote (a tela chama até terminar)
 *   rows/report → relatório por linha (tela e CSV)
 *
 * O arquivo é lido sempre do Storage pelo caminho que o banco autorizou;
 * quando o job termina, é apagado (dado pessoal). Nenhum conteúdo de planilha
 * vai para o log: só ids e contagens.
 */

export interface ImportDeps {
  storage: ImportStorage;
  now: () => Date;
}

const defaultDeps = (): ImportDeps => ({ storage: signedImportStorage(), now: () => new Date() });

/** Linhas enviadas ao banco por chamada na simulação (o banco aceita até 1.000). */
const STAGE_CHUNK = 500;
/** Linhas gravadas por chamada (cabe no statement_timeout do usuário). */
const PROCESS_BATCH = 50;
const PREVIEW_ROWS = 5;

const TERMINAL: ImportJobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

function requireAdmin(ctx: ServiceContext) {
  requirePermission(ctx, "imports.manage");
}

export function fileTypeOf(fileName: string): ImportFileType | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".xlsx")) return "XLSX";
  return undefined;
}

/** Hoje no fuso do escritório (AAAA-MM-DD). */
export function todayInOffice(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function checkPath(jobId: string, fileType: ImportFileType, path: string) {
  if (path !== importObjectName(jobId, fileType)) throw new DomainError("INTERNAL", undefined, { technicalCode: "import_path_mismatch" });
}

async function readJobFile(ctx: ServiceContext, deps: ImportDeps, jobId: string, sheetName?: string | null): Promise<{ table: ReadResult; checksum: string; fileType: ImportFileType }> {
  const auth = await repo.authorizeFile(ctx.db, jobId);
  checkPath(jobId, auth.file_type, auth.storage_object_name);
  const bytes = await deps.storage.download(auth.storage_object_name, MAX_IMPORT_FILE_BYTES);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const table = readSpreadsheet(bytes, auth.file_type, sheetName === undefined ? auth.sheet_name : sheetName);
  return { table, checksum, fileType: auth.file_type };
}

/* ------------------------------------------------------------------ */
/* 1. Início e upload                                                  */
/* ------------------------------------------------------------------ */

export async function startImport(ctx: ServiceContext, input: StartImportInput, deps: ImportDeps = defaultDeps()): Promise<StartedImportDTO> {
  requireAdmin(ctx);
  const fileType = fileTypeOf(input.fileName);
  if (!fileType) throw new DomainError("VALIDATION", "Formato não aceito: envie um arquivo Excel (.xlsx) ou CSV. Arquivo .xls antigo: abra no Excel e salve como .xlsx.");
  if (input.sizeBytes > MAX_IMPORT_FILE_BYTES) throw new DomainError("VALIDATION", "Arquivo maior que o limite de 20 MB. Divida a planilha.");
  const job = await repo.createJob(ctx.db, input.fileName, fileType);
  checkPath(job.import_job_id, fileType, job.storage_object_name);
  const signed = await deps.storage.createSignedUploadUrl(job.storage_object_name);
  ctx.log.info("import.started", { jobId: job.import_job_id, fileType, sizeBytes: input.sizeBytes });
  return { jobId: job.import_job_id, bucket: IMPORTS_BUCKET, path: job.storage_object_name, token: signed.token, contentType: IMPORT_CONTENT_TYPE[fileType] };
}

/* ------------------------------------------------------------------ */
/* 2. Colunas                                                          */
/* ------------------------------------------------------------------ */

export async function readColumns(ctx: ServiceContext, input: { jobId: string; sheetName?: string }, deps: ImportDeps = defaultDeps()): Promise<ColumnsDTO> {
  requireAdmin(ctx);
  let read: Awaited<ReturnType<typeof readJobFile>>;
  try {
    read = await readJobFile(ctx, deps, input.jobId, input.sheetName ?? null);
  } catch (e) {
    if (!(e instanceof ImportFileError)) throw e;
    // Primeira leitura: arquivo ilegível encerra o job (FAILED, com o motivo).
    // Troca de aba que falha: só avisa, o job continua.
    if (!input.sheetName) {
      await repo.failJob(ctx.db, input.jobId, e.message);
      await removeFile(ctx, deps, input.jobId).catch((err: unknown) => ctx.log.warn("import.file_delete_failed", { jobId: input.jobId, error: err instanceof Error ? err.message : String(err) }));
    }
    throw new DomainError("VALIDATION", e.message);
  }
  const { table, checksum } = read;
  const reg = await repo.registerColumns(ctx.db, input.jobId, checksum, table.sheetName, table.headers, table.rows.length);
  ctx.log.info("import.columns", { jobId: input.jobId, columns: table.headers.length, rows: table.rows.length });
  return {
    jobId: input.jobId,
    headers: table.headers,
    headerLine: table.headerLine,
    preview: table.rows.slice(0, PREVIEW_ROWS),
    sheets: table.sheets,
    sheetName: table.sheetName,
    totalRows: table.rows.length,
    sameFileJobs: (reg.same_file_jobs ?? []).map(
      (j): SameFileJobDTO => ({ id: String(j.id), fileName: String(j.file_name), status: j.status as ImportJobStatus, createdAt: String(j.created_at) }),
    ),
    suggestedMapping: suggestMapping(table.headers),
  };
}

/** Só leitura: cabeçalho e prévia do arquivo já registrado (reabrir o mapeamento sem apagar nada). */
export async function previewColumns(ctx: ServiceContext, jobId: string, deps: ImportDeps = defaultDeps()): Promise<ColumnsDTO> {
  requireAdmin(ctx);
  let table: ReadResult;
  try {
    ({ table } = await readJobFile(ctx, deps, jobId));
  } catch (e) {
    if (e instanceof ImportFileError) throw new DomainError("VALIDATION", e.message);
    throw e;
  }
  return {
    jobId,
    headers: table.headers,
    headerLine: table.headerLine,
    preview: table.rows.slice(0, PREVIEW_ROWS),
    sheets: table.sheets,
    sheetName: table.sheetName,
    totalRows: table.rows.length,
    sameFileJobs: [],
    suggestedMapping: suggestMapping(table.headers),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Mapeamento + simulação                                           */
/* ------------------------------------------------------------------ */

export async function getReferenceData(ctx: ServiceContext): Promise<ImportReferenceDTO> {
  requireAdmin(ctx);
  const r = await repo.referenceData(ctx.db);
  return {
    areas: (r.areas ?? []).map((a) => ({ id: String(a.id), code: String(a.code), name: String(a.name) })),
    users: (r.users ?? []).map((u) => ({ id: String(u.id), name: String(u.preferred_name || u.name || ""), role: String(u.role) })),
  };
}

export async function simulate(ctx: ServiceContext, input: SimulateInput, deps: ImportDeps = defaultDeps()): Promise<ImportJobDTO> {
  requireAdmin(ctx);
  await repo.saveMapping(
    ctx.db,
    input.jobId,
    input.mapping.map((m) => ({ source_column: m.sourceColumn, target_field: m.targetField })),
    { legal_area_id: input.options.legalAreaId ?? null, lawyer_id: input.options.lawyerId ?? null },
  );

  let table: ReadResult;
  try {
    ({ table } = await readJobFile(ctx, deps, input.jobId));
  } catch (e) {
    if (e instanceof ImportFileError) throw new DomainError("VALIDATION", e.message);
    throw e;
  }
  const job = await repo.getJob(ctx.db, input.jobId);
  const detected = Array.isArray(job?.detected_columns) ? (job!.detected_columns as string[]) : [];
  if (detected.join("\u0000") !== table.headers.join("\u0000") || table.rows.length !== job?.total_rows) {
    throw new DomainError("INVALID_STATE", "O arquivo mudou desde a leitura das colunas. Comece uma nova importação.");
  }

  const ref = await repo.referenceData(ctx.db);
  const users: ImportUser[] = (ref.users ?? []).map((u) => ({ id: String(u.id), name: String(u.name ?? ""), preferredName: (u.preferred_name as string | null) ?? null, role: String(u.role) }));
  const mapping = Object.fromEntries(input.mapping.map((m) => [m.targetField, m.sourceColumn]));
  const staged = normalizeRows(table.headers, table.rows, mapping, { users, lawyerId: input.options.lawyerId, today: todayInOffice(deps.now()) });

  for (let i = 0; i < staged.length; i += STAGE_CHUNK) {
    await repo.stageRows(ctx.db, input.jobId, staged.slice(i, i + STAGE_CHUNK), i === 0);
  }
  const done = await repo.finishDryRun(ctx.db, input.jobId);
  ctx.log.info("import.simulated", {
    jobId: input.jobId,
    rows: staged.length,
    errors: staged.filter((r) => r.status === "ERROR").length,
    warnings: staged.filter((r) => r.status === "WARNING").length,
    openConflicts: done.open_conflicts,
  });
  return getJob(ctx, input.jobId);
}

/* ------------------------------------------------------------------ */
/* 4. Leitura                                                          */
/* ------------------------------------------------------------------ */

export async function getJob(ctx: ServiceContext, jobId: string): Promise<ImportJobDTO> {
  requireAdmin(ctx);
  const row = await repo.getJob(ctx.db, jobId);
  if (!row) throw new DomainError("NOT_FOUND", "Importação não encontrada.");
  const [mappings, names] = await Promise.all([repo.getMappings(ctx.db, jobId), repo.profileNames(ctx.db, [row.created_by ?? "", row.confirmed_by ?? ""])]);
  const hasDryRun = ["VALIDATED", "CONFLICTS_PENDING", "CONFIRMED"].includes(row.status);
  const hasResult = ["PROCESSING", "COMPLETED"].includes(row.status) || (row.status === "CANCELLED" && row.started_at !== null);
  const [plan, result] = await Promise.all([
    hasDryRun || hasResult ? repo.getPlan(ctx.db, jobId).then(toPlan) : Promise.resolve(undefined),
    // Resultado: process_batch num job concluído só lê as contagens (não grava nada).
    row.status === "COMPLETED" ? repo.processBatch(ctx.db, jobId, 1).then(toBatch) : Promise.resolve(undefined),
  ]);
  return {
    ...toJobSummary(row, names),
    sheetName: row.sheet_name ?? undefined,
    detectedColumns: Array.isArray(row.detected_columns) ? (row.detected_columns as string[]) : [],
    mapping: toMapping(mappings),
    options: toOptions(row.options),
    dryRunAt: row.dry_run_at ?? undefined,
    confirmedAt: row.confirmed_at ?? undefined,
    confirmedByName: row.confirmed_by ? names.get(row.confirmed_by) : undefined,
    startedAt: row.started_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    fileAvailable: !!row.storage_object_name && !row.source_file_deleted_at && !TERMINAL.includes(row.status),
    plan,
    result,
  };
}

export async function listJobs(ctx: ServiceContext, page: PageInput, deps: ImportDeps = defaultDeps()): Promise<Page<ImportJobSummaryDTO>> {
  requireAdmin(ctx);
  const { rows, total } = await repo.listJobs(ctx.db, page);
  const names = await repo.profileNames(ctx.db, rows.map((r) => r.created_by ?? ""));
  // Limpeza preguiçosa: arquivo de job encerrado que ficou no Storage.
  await cleanupFiles(ctx, deps).catch((e: unknown) => ctx.log.warn("import.cleanup_failed", { error: e instanceof Error ? e.message : String(e) }));
  return toPage(rows.map((r) => toJobSummary(r, names)), total, page);
}

const FILTER_STATUSES: Record<string, string[] | null> = {
  all: null,
  problems: ["ERROR", "WARNING"],
  errors: ["ERROR"],
  warnings: ["WARNING"],
  imported: ["IMPORTED"],
  skipped: ["SKIPPED"],
};

export async function listRows(ctx: ServiceContext, input: PageInput & { jobId: string; filter: string }): Promise<Page<ImportRowDTO>> {
  requireAdmin(ctx);
  const from = (input.page - 1) * input.pageSize;
  const [{ rows, total }, mappings] = await Promise.all([
    repo.listRows(ctx.db, input.jobId, FILTER_STATUSES[input.filter] ?? null, { from, to: from + input.pageSize - 1 }),
    repo.getMappings(ctx.db, input.jobId),
  ]);
  const cols = rowColumns(toMapping(mappings));
  return toPage(rows.map((r) => toRow(r, cols)), total, input);
}

export async function getConflicts(ctx: ServiceContext, input: { jobId: string; offset: number; limit: number }): Promise<ImportConflictsDTO> {
  requireAdmin(ctx);
  return toConflicts(await repo.getConflicts(ctx.db, input.jobId, input.offset, input.limit));
}

/* ------------------------------------------------------------------ */
/* 5. Decisão, confirmação e gravação                                  */
/* ------------------------------------------------------------------ */

export async function resolveConflicts(ctx: ServiceContext, input: ResolveConflictsInput): Promise<{ openConflicts: number; status: ImportJobStatus }> {
  requireAdmin(ctx);
  const items = input.items.map((i) => ("conflictId" in i ? { conflict_id: i.conflictId, resolution: i.resolution } : { kind: i.kind, resolution: i.resolution }));
  const r = await repo.resolveConflicts(ctx.db, input.jobId, items);
  return { openConflicts: r.open_conflicts, status: r.status as ImportJobStatus };
}

export async function confirmImport(ctx: ServiceContext, jobId: string): Promise<ImportJobDTO> {
  requireAdmin(ctx);
  await repo.confirm(ctx.db, jobId);
  ctx.log.info("import.confirmed", { jobId });
  return getJob(ctx, jobId);
}

export async function processBatch(ctx: ServiceContext, jobId: string, deps: ImportDeps = defaultDeps()): Promise<ImportBatchDTO> {
  requireAdmin(ctx);
  const r = toBatch(await repo.processBatch(ctx.db, jobId, PROCESS_BATCH));
  if (r.status === "COMPLETED" && r.processed > 0) {
    ctx.log.info("import.completed", { jobId, imported: r.imported, skipped: r.skipped, failed: r.failed });
    await removeFile(ctx, deps, jobId).catch((e: unknown) => ctx.log.warn("import.file_delete_failed", { jobId, error: e instanceof Error ? e.message : String(e) }));
  }
  return r;
}

export async function cancelImport(ctx: ServiceContext, jobId: string, deps: ImportDeps = defaultDeps()): Promise<void> {
  requireAdmin(ctx);
  await repo.cancel(ctx.db, jobId);
  ctx.log.info("import.cancelled", { jobId });
  await removeFile(ctx, deps, jobId).catch((e: unknown) => ctx.log.warn("import.file_delete_failed", { jobId, error: e instanceof Error ? e.message : String(e) }));
}

/* ------------------------------------------------------------------ */
/* 6. Relatório                                                        */
/* ------------------------------------------------------------------ */

const REPORT_PAGE = 1000;

export async function buildReport(ctx: ServiceContext, input: { jobId: string; only: "all" | "problems" }): Promise<ImportReportDTO> {
  requireAdmin(ctx);
  const job = await repo.getJob(ctx.db, input.jobId);
  if (!job) throw new DomainError("NOT_FOUND", "Importação não encontrada.");
  const statuses = input.only === "problems" ? ["ERROR", "WARNING", "SKIPPED"] : null;
  const rows: ImportRowDTO[] = [];
  for (let from = 0; ; from += REPORT_PAGE) {
    const page = await repo.listRows(ctx.db, input.jobId, statuses, { from, to: from + REPORT_PAGE - 1 });
    rows.push(...page.rows.map((r) => toRow(r)));
    if (page.rows.length < REPORT_PAGE) break;
  }
  const columns = Array.isArray(job.detected_columns) ? (job.detected_columns as string[]) : [];
  const base = job.file_name.replace(/\.(csv|xlsx)$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 80) || "importacao";
  return { fileName: `relatorio-${base}${input.only === "problems" ? "-problemas" : ""}.csv`, csv: buildReportCsv(rows, columns), rows: rows.length };
}

/* ------------------------------------------------------------------ */
/* Arquivo                                                             */
/* ------------------------------------------------------------------ */

async function removeFile(ctx: ServiceContext, deps: ImportDeps, jobId: string) {
  const list = await repo.filesToDelete(ctx.db, 100);
  const item = list.find((x) => x.id === jobId);
  if (!item) return;
  await deps.storage.remove(item.storage_object_name);
  await repo.markFileDeleted(ctx.db, jobId);
}

async function cleanupFiles(ctx: ServiceContext, deps: ImportDeps) {
  const list = await repo.filesToDelete(ctx.db, 10);
  for (const item of list) {
    if (!item.storage_object_name.startsWith(`jobs/${item.id.toLowerCase()}/`)) continue;
    await deps.storage.remove(item.storage_object_name);
    await repo.markFileDeleted(ctx.db, item.id);
  }
}
