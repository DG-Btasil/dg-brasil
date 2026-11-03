import type { ImportFieldKey } from "@/lib/domain/import-fields";

export const IMPORT_JOB_STATUSES = [
  "UPLOADED",
  "COLUMNS_DETECTED",
  "MAPPED",
  "VALIDATED",
  "CONFLICTS_PENDING",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export type ImportFileType = "CSV" | "XLSX";

export interface StartedImportDTO {
  jobId: string;
  bucket: string;
  path: string;
  token: string;
  contentType: string;
}

export interface SameFileJobDTO {
  id: string;
  fileName: string;
  status: ImportJobStatus;
  createdAt: string;
}

export interface ColumnsDTO {
  jobId: string;
  headers: string[];
  /** Linha do arquivo com o cabeçalho (título acima é pulado). */
  headerLine: number;
  /** Primeiras linhas (prévia do conteúdo), na ordem das colunas. */
  preview: { line: number; cells: string[] }[];
  sheets: string[];
  sheetName?: string;
  totalRows: number;
  sameFileJobs: SameFileJobDTO[];
  suggestedMapping: Record<string, ImportFieldKey | "">;
}

export interface ImportPlanDTO {
  rowsTotal: number;
  rowsError: number;
  rowsToImport: number;
  rowsToSkip: number;
  clientsCreate: number;
  clientsUpdate: number;
  clientsKeep: number;
  clientsSkip: number;
  processesCreate: number;
  processesUpdate: number;
  processesKeep: number;
  processesSkip: number;
  casesCreate: number;
  deadlinesCreate: number;
}

export interface ImportJobSummaryDTO {
  id: string;
  fileName: string;
  fileType: ImportFileType;
  status: ImportJobStatus;
  createdAt: string;
  createdByName?: string;
  totalRows?: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  completedAt?: string;
}

export interface ImportJobDTO extends ImportJobSummaryDTO {
  sheetName?: string;
  detectedColumns: string[];
  mapping: { sourceColumn: string; targetField: ImportFieldKey }[];
  options: { legalAreaId?: string; lawyerId?: string };
  dryRunAt?: string;
  confirmedAt?: string;
  confirmedByName?: string;
  startedAt?: string;
  errorMessage?: string;
  fileAvailable: boolean;
  /** Prévia (a partir da simulação). */
  plan?: ImportPlanDTO;
  /** Resultado (durante/depois da gravação). */
  result?: ImportBatchDTO;
}

export interface ImportBatchDTO {
  status: ImportJobStatus;
  processed: number;
  remaining: number;
  imported: number;
  importedWithWarnings: number;
  skipped: number;
  failed: number;
  failedOnSave: number;
  clientsCreated: number;
  clientsUpdated: number;
  processesCreated: number;
  processesUpdated: number;
  deadlinesCreated: number;
}

export type ImportRowStatus = "VALID" | "WARNING" | "ERROR" | "IMPORTED" | "SKIPPED";

export interface ImportRowDTO {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  /** Linha original (apagada 30 dias depois do fim da importação). */
  raw?: Record<string, string>;
  clientName?: string;
  clientDocument?: string;
  processCnj?: string;
  /** Linha com erro (sem payload): CPF/CNPJ e CNJ como estão na planilha. */
  rawDocument?: string;
  rawCnj?: string;
  outcome?: {
    result?: string;
    clientAction?: string;
    processAction?: string;
    clientId?: string;
    legalCaseId?: string;
    legalProcessId?: string;
    deadlineId?: string;
    reason?: string;
  };
}

export type ImportConflictKind = "CLIENT_DOCUMENT" | "PROCESS_CNJ" | "POSSIBLE_DUPLICATE";
export type ImportResolution = "UPDATE" | "IGNORE" | "CREATE_NEW";

export interface ImportConflictDTO {
  id: string;
  rowNumber: number;
  kind: ImportConflictKind;
  resolution?: ImportResolution;
  existingId: string;
  existingLabel?: string;
  existingDocument?: string;
  existingClientName?: string;
  rowClientName?: string;
  rowClientDocument?: string;
  rowProcessCnj?: string;
  rowsWithSameClient?: number;
}

export interface ImportConflictsDTO {
  total: number;
  open: number;
  byKind: Partial<Record<ImportConflictKind, number>>;
  items: ImportConflictDTO[];
}

export interface ImportReferenceDTO {
  areas: { id: string; code: string; name: string }[];
  users: { id: string; name: string; role: string }[];
}

export interface ImportReportDTO {
  fileName: string;
  csv: string;
  rows: number;
}
