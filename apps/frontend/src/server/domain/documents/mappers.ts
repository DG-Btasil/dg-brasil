import type { DocumentVerification, DocumentVisibility } from "@/lib/constants/status";
import { DOCUMENT_VERIFICATION_FROM_DB, type DbDocumentVerification } from "@/repositories/api/db-mappings";
import type {
  DocumentApprovalStatus,
  DocumentInternalDTO,
  DocumentListItemInternal,
  DocumentListItemPartner,
  DocumentPartnerDTO,
  DocumentStatusDb,
  DocumentVersionInternalDTO,
  DocumentVersionPartnerDTO,
} from "./dto";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * documents.test.ts. O caminho no Storage (`storage_object_name`) nunca entra
 * em DTO: fica só no servidor, para assinar URL.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface DocumentRow {
  id: string;
  client_id: string;
  category: string;
  title: string;
  description: string | null;
  visibility: DocumentVisibility;
  status: DocumentStatusDb;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface VersionRow {
  id: string;
  document_id: string;
  version_number: number;
  storage_object_name: string;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | string | null;
  source: DocumentVersionInternalDTO["source"];
  created_by: string | null;
  created_at: string;
}

export interface VerificationStatusRow {
  document_version_id: string;
  verification_status: DbDocumentVerification;
  verified_at: string | null;
}

export interface ApprovalRow {
  document_version_id: string;
  approval_status: DocumentApprovalStatus;
}

/** Estado derivado por versão (views da 007 e da 009), indexado pelo id da versão. */
export interface VersionStatusIndex {
  verification: Map<string, VerificationStatusRow>;
  /** Vazio para o parceiro: aprovação é dado interno. */
  approval: Map<string, DocumentApprovalStatus>;
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const size = (v: number | string | null): number | undefined => (v === null || v === undefined ? undefined : Number(v));

export function verificationOf(versionId: string, index: VersionStatusIndex): DocumentVerification {
  const row = index.verification.get(versionId);
  return row ? DOCUMENT_VERIFICATION_FROM_DB[row.verification_status] : "UNVERIFIED";
}

/** Indexa as linhas das views. */
export function buildStatusIndex(verifications: VerificationStatusRow[], approvals: ApprovalRow[]): VersionStatusIndex {
  return {
    verification: new Map(verifications.map((r) => [r.document_version_id, r])),
    approval: new Map(approvals.map((r) => [r.document_version_id, r.approval_status])),
  };
}

export function internalVersionFromRow(row: VersionRow, index: VersionStatusIndex): DocumentVersionInternalDTO {
  return {
    id: row.id,
    versionNumber: row.version_number,
    fileName: opt(row.original_filename),
    mimeType: opt(row.mime_type),
    sizeBytes: size(row.file_size),
    source: row.source,
    createdBy: opt(row.created_by),
    createdAt: row.created_at,
    verification: verificationOf(row.id, index),
    verifiedAt: opt(index.verification.get(row.id)?.verified_at),
    // Sem linha na view (não deveria acontecer): pendente.
    approval: index.approval.get(row.id) ?? "PENDING",
  };
}

/** Parceiro: arquivo e verificação. Sem origem, autor, aprovação, caminho. */
export function partnerVersionFromRow(row: VersionRow, index: VersionStatusIndex): DocumentVersionPartnerDTO {
  return {
    id: row.id,
    versionNumber: row.version_number,
    fileName: opt(row.original_filename),
    mimeType: opt(row.mime_type),
    sizeBytes: size(row.file_size),
    createdAt: row.created_at,
    verification: verificationOf(row.id, index),
  };
}

/** Versão atual = maior número. */
export function currentVersionOf(versions: VersionRow[]): VersionRow | undefined {
  return versions.reduce<VersionRow | undefined>((best, v) => (!best || v.version_number > best.version_number ? v : best), undefined);
}

function internalBase(row: DocumentRow): Omit<DocumentListItemInternal, "currentVersion"> {
  return {
    id: row.id,
    clientId: row.client_id,
    category: row.category,
    title: row.title,
    visibility: row.visibility,
    status: row.status,
    createdBy: opt(row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Base do parceiro: sem visibilidade (é sempre PARTNER_VISIBLE), autor nem descrição. */
function partnerBase(row: DocumentRow): Omit<DocumentListItemPartner, "currentVersion"> {
  return {
    id: row.id,
    clientId: row.client_id,
    category: row.category,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function internalListItemFromRow(row: DocumentRow, current: VersionRow | undefined, index: VersionStatusIndex): DocumentListItemInternal {
  return { ...internalBase(row), currentVersion: current ? internalVersionFromRow(current, index) : undefined };
}

export function partnerListItemFromRow(row: DocumentRow, current: VersionRow | undefined, index: VersionStatusIndex): DocumentListItemPartner {
  return { ...partnerBase(row), currentVersion: current ? partnerVersionFromRow(current, index) : undefined };
}

const byNewest = (a: VersionRow, b: VersionRow) => b.version_number - a.version_number;

export interface DocumentLinks {
  legalCaseIds: string[];
  legalProcessIds: string[];
}

export function internalDocumentFromRows(row: DocumentRow, versions: VersionRow[], index: VersionStatusIndex, links: DocumentLinks): DocumentInternalDTO {
  return {
    ...internalBase(row),
    description: opt(row.description),
    versions: [...versions].sort(byNewest).map((v) => internalVersionFromRow(v, index)),
    legalCaseIds: links.legalCaseIds,
    legalProcessIds: links.legalProcessIds,
  };
}

export function partnerDocumentFromRows(row: DocumentRow, versions: VersionRow[], index: VersionStatusIndex, links: DocumentLinks): DocumentPartnerDTO {
  return {
    ...partnerBase(row),
    versions: [...versions].sort(byNewest).map((v) => partnerVersionFromRow(v, index)),
    legalCaseIds: links.legalCaseIds,
    legalProcessIds: links.legalProcessIds,
  };
}

/** Nome sugerido no download: o nome original sanitizado (sem caminho). */
export function downloadNameOf(version: Pick<VersionRow, "original_filename" | "storage_object_name">, sanitize: (name: string) => string): string {
  if (version.original_filename) return sanitize(version.original_filename);
  const last = version.storage_object_name.split("/").pop();
  return last && last !== "" ? last : "arquivo";
}
