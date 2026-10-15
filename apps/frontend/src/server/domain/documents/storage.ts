import { DomainError } from "@/server/core/errors";

/**
 * Storage de documentos jurídicos (bucket privado `legal-documents`, 017).
 *
 * - O caminho do objeto segue a MESMA regra de `private.legal_document_object_name`
 *   (007): `clients/{client_id}/documents/{document_id}/{version_id}/{arquivo}`.
 *   A função do banco só tem EXECUTE para service_role/dg_worker, então a regra
 *   é reproduzida aqui (testada em storage.test.ts) — e o trigger
 *   `document_versions_validate` recusa qualquer caminho fora do padrão.
 * - O caminho NÃO é mecanismo de segurança: a autorização é do service + RLS.
 * - O usuário não assina URL nos buckets privados (017). A assinatura é feita
 *   em `signed-storage.ts` (service role), SÓ para o caminho que o banco
 *   autorizou com o JWT do usuário (authorize_document_upload/download, 026).
 * - O caminho contém o nome do arquivo (pode ter dado pessoal): nunca vai
 *   para log. Logue só IDs.
 */

export const LEGAL_DOCUMENTS_BUCKET = "legal-documents";

/** Validade das URLs assinadas: download curto; upload o suficiente para enviar 50 MB. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Limite e tipos aceitos pelo bucket (017). O bucket confere de novo no upload. */
export const MAX_FILE_SIZE_BYTES = 52_428_800;
export const ALLOWED_MIME_TYPES = [
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
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Igual a `private.sanitize_filename` (007):
 *   coalesce(nullif(left(btrim(regexp_replace(nome, '[^A-Za-z0-9._-]+', '_', 'g'), '._'), 150), ''), 'arquivo')
 */
export function sanitizeFilename(filename: string | null | undefined): string {
  const replaced = (filename ?? "").replace(/[^A-Za-z0-9._-]+/g, "_");
  const trimmed = replaced.replace(/^[._]+/, "").replace(/[._]+$/, "");
  const cut = trimmed.slice(0, 150);
  return cut === "" ? "arquivo" : cut;
}

/** Igual a `private.legal_document_object_name` (007). IDs sempre em minúsculas, como o Postgres formata uuid. */
export function legalDocumentObjectName(clientId: string, documentId: string, versionId: string, filename: string): string {
  return `clients/${clientId.toLowerCase()}/documents/${documentId.toLowerCase()}/${versionId.toLowerCase()}/${sanitizeFilename(filename)}`;
}

/** O caminho pertence a esta versão (mesma conferência do trigger da 007)? */
export function objectNameMatchesVersion(objectName: string, clientId: string, documentId: string, versionId: string): boolean {
  const prefix = `clients/${clientId.toLowerCase()}/documents/${documentId.toLowerCase()}/${versionId.toLowerCase()}/`;
  if (!objectName.startsWith(prefix)) return false;
  const rest = objectName.slice(prefix.length);
  return rest !== "" && !rest.includes("/");
}

/* ------------------------------------------------------------------ */
/* Porta de Storage (injetável: o service é testável sem rede)          */
/* ------------------------------------------------------------------ */

export interface SignedUpload {
  signedUrl: string;
  token: string;
}

export interface StoredObjectInfo {
  sizeBytes?: number;
  contentType?: string;
}

export interface DocumentStorage {
  createSignedUploadUrl(objectName: string): Promise<SignedUpload>;
  /** null = objeto não existe (ou o usuário não o enxerga). */
  getObjectInfo(objectName: string): Promise<StoredObjectInfo | null>;
  createSignedDownloadUrl(objectName: string, expiresInSeconds: number, downloadName: string): Promise<string>;
  /**
   * Bytes de um objeto (edição manual de minuta de texto, 4.3.1). Só caminho
   * que o banco autorizou (authorize_document_download: LGPD + auditoria).
   * Acima de `maxBytes` → VALIDATION (não carrega arquivo grande na memória).
   */
  downloadObject(objectName: string, maxBytes: number): Promise<Uint8Array>;
  /** Grava objeto NOVO (write-once: nunca sobrescreve). Só caminho autorizado (prepare_manual_revision, 034). */
  uploadObject(objectName: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/** Erro do Storage → erro de domínio. Nunca repassa a mensagem (pode conter o caminho). */
export function fromStorageError(error: { status?: number; statusCode?: string; message?: string } | null | undefined): DomainError {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  const technicalCode = `storage_${status || "unknown"}`;
  if (status === 400 || status === 404) return new DomainError("NOT_FOUND", "Arquivo não encontrado.", { technicalCode });
  if (status === 401 || status === 403) return new DomainError("FORBIDDEN", undefined, { technicalCode });
  if (status === 409) return new DomainError("CONFLICT", "Este arquivo já foi enviado.", { technicalCode });
  if (status === 413) return new DomainError("VALIDATION", "Arquivo maior que o limite de 50 MB.", { technicalCode });
  return new DomainError("INTERNAL", undefined, { technicalCode });
}
