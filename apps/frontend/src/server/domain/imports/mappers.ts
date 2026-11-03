import { isImportFieldKey, type ImportFieldKey } from "@/lib/domain/import-fields";
import type {
  ImportBatchDTO,
  ImportConflictDTO,
  ImportConflictsDTO,
  ImportFileType,
  ImportJobStatus,
  ImportJobSummaryDTO,
  ImportPlanDTO,
  ImportRowDTO,
  ImportRowStatus,
} from "./dto";

/** Banco (snake_case, jsonb) → DTO. Sem I/O. */

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export interface ImportJobRow {
  id: string;
  file_name: string;
  file_type: ImportFileType;
  status: ImportJobStatus;
  sheet_name: string | null;
  detected_columns: unknown;
  options: unknown;
  total_rows: number | null;
  successful_rows: number;
  warning_rows: number;
  failed_rows: number;
  dry_run_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  storage_object_name: string | null;
  source_file_deleted_at: string | null;
}

export const IMPORT_JOB_COLUMNS =
  "id, file_name, file_type, status, sheet_name, detected_columns, options, total_rows, successful_rows, warning_rows, failed_rows, dry_run_at, confirmed_by, confirmed_at, created_by, created_at, started_at, completed_at, error_message, storage_object_name, source_file_deleted_at";

export function toJobSummary(r: ImportJobRow, names: Map<string, string>): ImportJobSummaryDTO {
  return {
    id: r.id,
    fileName: r.file_name,
    fileType: r.file_type,
    status: r.status,
    createdAt: r.created_at,
    createdByName: r.created_by ? names.get(r.created_by) : undefined,
    totalRows: r.total_rows ?? undefined,
    successfulRows: r.successful_rows,
    warningRows: r.warning_rows,
    failedRows: r.failed_rows,
    completedAt: r.completed_at ?? undefined,
  };
}

export function toMapping(rows: { source_column: string; target_field: string }[]): { sourceColumn: string; targetField: ImportFieldKey }[] {
  return rows.filter((m) => isImportFieldKey(m.target_field)).map((m) => ({ sourceColumn: m.source_column, targetField: m.target_field as ImportFieldKey }));
}

export function toOptions(v: unknown): { legalAreaId?: string; lawyerId?: string } {
  const o = (v && typeof v === "object" ? v : {}) as Json;
  return { legalAreaId: str(o.legal_area_id), lawyerId: str(o.lawyer_id) };
}

export function toPlan(v: Json): ImportPlanDTO {
  return {
    rowsTotal: num(v.rows_total),
    rowsError: num(v.rows_error),
    rowsToImport: num(v.rows_to_import),
    rowsToSkip: num(v.rows_to_skip),
    clientsCreate: num(v.clients_create),
    clientsUpdate: num(v.clients_update),
    clientsKeep: num(v.clients_keep),
    clientsSkip: num(v.clients_skip),
    processesCreate: num(v.processes_create),
    processesUpdate: num(v.processes_update),
    processesKeep: num(v.processes_keep),
    processesSkip: num(v.processes_skip),
    casesCreate: num(v.cases_create),
    deadlinesCreate: num(v.deadlines_create),
  };
}

export function toBatch(v: Json): ImportBatchDTO {
  return {
    status: (str(v.status) ?? "PROCESSING") as ImportJobStatus,
    processed: num(v.processed),
    remaining: num(v.remaining),
    imported: num(v.imported),
    importedWithWarnings: num(v.imported_with_warnings),
    skipped: num(v.skipped),
    failed: num(v.failed),
    failedOnSave: num(v.failed_on_save),
    clientsCreated: num(v.clients_created),
    clientsUpdated: num(v.clients_updated),
    processesCreated: num(v.processes_created),
    processesUpdated: num(v.processes_updated),
    deadlinesCreated: num(v.deadlines_created),
  };
}

export interface ImportRowRow {
  row_number: number;
  status: ImportRowStatus;
  errors: unknown;
  warnings: unknown;
  raw_data: unknown;
  payload: unknown;
  outcome: unknown;
}

export function toRow(r: ImportRowRow): ImportRowDTO {
  const payload = (r.payload && typeof r.payload === "object" ? r.payload : {}) as { client?: Json; process?: Json };
  const o = r.outcome && typeof r.outcome === "object" ? (r.outcome as Json) : undefined;
  const raw = r.raw_data && typeof r.raw_data === "object" ? (r.raw_data as Record<string, string>) : undefined;
  return {
    rowNumber: r.row_number,
    status: r.status,
    errors: strings(r.errors),
    warnings: strings(r.warnings),
    raw,
    clientName: str(payload.client?.name),
    clientDocument: str(payload.client?.document),
    processCnj: str(payload.process?.cnj),
    outcome: o && {
      result: str(o.result),
      clientAction: str(o.client_action),
      processAction: str(o.process_action),
      clientId: str(o.client_id),
      legalCaseId: str(o.legal_case_id),
      legalProcessId: str(o.legal_process_id),
      deadlineId: str(o.deadline_id),
      reason: str(o.reason),
    },
  };
}

export function toConflicts(v: Json): ImportConflictsDTO {
  const items = Array.isArray(v.items) ? (v.items as Json[]) : [];
  return {
    total: num(v.total),
    open: num(v.open),
    byKind: (v.by_kind && typeof v.by_kind === "object" ? v.by_kind : {}) as ImportConflictsDTO["byKind"],
    items: items.map(
      (c): ImportConflictDTO => ({
        id: String(c.id),
        rowNumber: num(c.row_number),
        kind: c.kind as ImportConflictDTO["kind"],
        resolution: str(c.resolution) as ImportConflictDTO["resolution"],
        existingId: String(c.existing_id),
        existingLabel: str(c.existing_label),
        existingDocument: str(c.existing_document),
        existingClientName: str(c.existing_client_name),
        rowClientName: str(c.row_client_name),
        rowClientDocument: str(c.row_client_document),
        rowProcessCnj: str(c.row_process_cnj),
        rowsWithSameClient: c.rows_with_same_client == null ? undefined : num(c.rows_with_same_client),
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Relatório CSV (abre no Excel em português: ";" e BOM UTF-8)         */
/* ------------------------------------------------------------------ */

const STATUS_LABEL: Record<ImportRowStatus, string> = {
  VALID: "Pronta para gravar",
  WARNING: "Pronta, com aviso",
  ERROR: "Não importada (erro)",
  IMPORTED: "Importada",
  SKIPPED: "Ignorada",
};

const ACTION_LABEL: Record<string, string> = {
  CREATE: "criado",
  UPDATE: "atualizado",
  KEEP: "mantido",
  LINK: "vinculado",
  SKIP: "ignorado",
};

export function describeOutcome(row: ImportRowDTO): string {
  const o = row.outcome;
  if (!o || o.result === "ERROR") return "";
  const parts: string[] = [];
  if (o.clientAction) parts.push(`cliente ${ACTION_LABEL[o.clientAction] ?? o.clientAction}`);
  if (o.processAction) parts.push(`processo ${ACTION_LABEL[o.processAction] ?? o.processAction}`);
  if (o.deadlineId) parts.push("prazo criado");
  return parts.join("; ") + (o.reason ? ` (${o.reason})` : "");
}

const cell = (v: string | number | undefined) => {
  const s = v === undefined ? "" : String(v);
  // Evita fórmula no Excel (=, +, -, @) e escapa aspas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function buildReportCsv(rows: ImportRowDTO[], columns: string[]): string {
  const header = ["Linha", "Situação", "O que aconteceu", "Erros", "Avisos", ...columns];
  const lines = rows.map((r) =>
    [r.rowNumber, STATUS_LABEL[r.status], describeOutcome(r), r.errors.join(" | "), r.warnings.join(" | "), ...columns.map((c) => r.raw?.[c] ?? "")].map(cell).join(";"),
  );
  return `﻿${[header.map(cell).join(";"), ...lines].join("\r\n")}\r\n`;
}
