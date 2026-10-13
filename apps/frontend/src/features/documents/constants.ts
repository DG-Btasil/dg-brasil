import type { DocumentCategory, DocumentVerification } from "@/lib/constants/status";

/**
 * Limites do bucket `legal-documents` (017), repetidos aqui só para avisar
 * ANTES do envio. O servidor (schema) e o bucket conferem de novo.
 * Mantidos em sincronia com server/domain/documents/storage.ts (teste).
 */
export const MAX_UPLOAD_BYTES = 52_428_800;
export const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
] as const;

/** `accept` do input de arquivo. */
export const FILE_ACCEPT = ALLOWED_FILE_TYPES.join(",");

/** Pendência de documento do caso: o que FALTA (não é arquivo). */
export const REQUIREMENT_STATUS_LABEL = {
  MISSING: "Não solicitado",
  REQUESTED: "Solicitado",
  RECEIVED: "Arquivo recebido",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
} as const;

export const REQUIREMENT_STATUS_TONE = {
  MISSING: "neutral",
  REQUESTED: "warning",
  RECEIVED: "info",
  APPROVED: "success",
  REJECTED: "danger",
} as const;

export const VERIFICATION_ORDER: DocumentVerification[] = ["UNVERIFIED", "VERIFIED", "FAILED"];

/** "12,4 MB" */
export function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/* ------------------------------------------------------------------ */
/* Consulta da lista de documentos (servidor e navegador)              */
/* ------------------------------------------------------------------ */

export type DocumentScope = { clientId: string } | { legalCaseId: string } | { legalProcessId: string };

export interface DocumentQuery {
  category: DocumentCategory | "";
  status: "ACTIVE" | "ARCHIVED";
  page: number;
}

export const DOCUMENT_PAGE_SIZE = 25;

/** Entrada de `listDocumentsAction` (o servidor valida de novo). */
export function documentListInput(scope: DocumentScope, q: DocumentQuery = { category: "", status: "ACTIVE", page: 1 }) {
  return { ...scope, category: q.category || undefined, status: q.status, page: q.page, pageSize: DOCUMENT_PAGE_SIZE };
}
