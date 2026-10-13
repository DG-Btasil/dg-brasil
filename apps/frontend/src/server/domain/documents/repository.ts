import type { SupabaseClient } from "@supabase/supabase-js";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { ApprovalRow, DocumentLinks, DocumentRow, VerificationStatusRow, VersionRow } from "./mappers";

/**
 * Acesso a dados de documentos (queries e inserts). Sem regra de negócio:
 * autorização contextual e invariantes ficam no service; a RLS e os triggers
 * do banco (007) são a segunda barreira. Colunas sempre explícitas.
 *
 * Inserções feitas por PARCEIRO são sem RETURNING (`.insert()` sem `.select()`):
 * o documento só fica visível a ele depois de vinculado ao caso (README).
 */

const DOCUMENT_COLUMNS = "id, client_id, category, title, description, visibility, status, created_by, created_at, updated_at, deleted_at";
const VERSION_COLUMNS = "id, document_id, version_number, storage_object_name, original_filename, mime_type, file_size, source, created_by, created_at";

export type DocumentScope = { kind: "client" | "case" | "process"; id: string };

export interface DocumentFilters {
  category?: string;
  visibility?: "INTERNAL" | "PARTNER_VISIBLE";
  status?: "ACTIVE" | "ARCHIVED";
}

export async function listDocuments(
  db: SupabaseClient,
  scope: DocumentScope,
  filters: DocumentFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: DocumentRow[]; total: number }> {
  // Caso/processo: inner join com o vínculo (a RLS do vínculo também vale para o parceiro).
  const columns =
    scope.kind === "case"
      ? `${DOCUMENT_COLUMNS}, case_documents!inner(legal_case_id)`
      : scope.kind === "process"
        ? `${DOCUMENT_COLUMNS}, process_documents!inner(legal_process_id)`
        : DOCUMENT_COLUMNS;
  let query = db.from("documents").select(columns, { count: "exact" }).is("deleted_at", null);
  if (scope.kind === "client") query = query.eq("client_id", scope.id);
  if (scope.kind === "case") query = query.eq("case_documents.legal_case_id", scope.id);
  if (scope.kind === "process") query = query.eq("process_documents.legal_process_id", scope.id);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.visibility) query = query.eq("visibility", filters.visibility);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as unknown as DocumentRow[], total: count ?? 0 };
}

export async function getDocument(db: SupabaseClient, id: string): Promise<DocumentRow | null> {
  return unwrap(await db.from("documents").select(DOCUMENT_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle()) as DocumentRow | null;
}

export async function listVersions(db: SupabaseClient, documentIds: string[]): Promise<VersionRow[]> {
  if (documentIds.length === 0) return [];
  return (unwrap(
    await db.from("document_versions").select(VERSION_COLUMNS).in("document_id", documentIds).order("version_number", { ascending: false }),
  ) ?? []) as VersionRow[];
}

export async function getVersion(db: SupabaseClient, versionId: string): Promise<VersionRow | null> {
  return unwrap(await db.from("document_versions").select(VERSION_COLUMNS).eq("id", versionId).maybeSingle()) as VersionRow | null;
}

export async function listVerificationStatus(db: SupabaseClient, versionIds: string[]): Promise<VerificationStatusRow[]> {
  if (versionIds.length === 0) return [];
  return (unwrap(
    await db.from("document_version_verification_status").select("document_version_id, verification_status, verified_at").in("document_version_id", versionIds),
  ) ?? []) as VerificationStatusRow[];
}

/** Só equipe interna (o parceiro não lê revisões: a view devolveria estado enganoso). */
export async function listApprovals(db: SupabaseClient, versionIds: string[]): Promise<ApprovalRow[]> {
  if (versionIds.length === 0) return [];
  return (unwrap(await db.from("document_version_approvals").select("document_version_id, approval_status").in("document_version_id", versionIds)) ??
    []) as ApprovalRow[];
}

export async function getLinks(db: SupabaseClient, documentId: string): Promise<DocumentLinks> {
  const [cases, processes] = await Promise.all([
    db.from("case_documents").select("legal_case_id").eq("document_id", documentId).order("created_at"),
    db.from("process_documents").select("legal_process_id").eq("document_id", documentId).order("created_at"),
  ]);
  return {
    legalCaseIds: ((unwrap(cases) ?? []) as { legal_case_id: string }[]).map((r) => r.legal_case_id),
    legalProcessIds: ((unwrap(processes) ?? []) as { legal_process_id: string }[]).map((r) => r.legal_process_id),
  };
}

/** Casos de PARCEIRO (partner_organization_id preenchido) aos quais o documento está ligado — direta ou via processo. */
export async function hasPartnerCaseLink(db: SupabaseClient, documentId: string): Promise<boolean> {
  const [direct, viaProcess] = await Promise.all([
    db.from("case_documents").select("legal_case_id, legal_cases!inner(partner_organization_id)", { count: "exact", head: true }).eq("document_id", documentId).not("legal_cases.partner_organization_id", "is", null),
    db
      .from("process_documents")
      .select("legal_process_id, legal_processes!inner(legal_cases!inner(partner_organization_id))", { count: "exact", head: true })
      .eq("document_id", documentId)
      .not("legal_processes.legal_cases.partner_organization_id", "is", null),
  ]);
  if (direct.error) throw fromDbError(direct.error);
  if (viaProcess.error) throw fromDbError(viaProcess.error);
  return (direct.count ?? 0) + (viaProcess.count ?? 0) > 0;
}

/* ------------------------------------------------------------------ */
/* Caso / processo (referência para vínculo e cliente)                 */
/* ------------------------------------------------------------------ */

export interface CaseRef {
  id: string;
  client_id: string;
  partner_organization_id: string | null;
}

export async function getCaseRef(db: SupabaseClient, caseId: string): Promise<CaseRef | null> {
  return unwrap(
    await db.from("legal_cases").select("id, client_id, partner_organization_id").eq("id", caseId).is("deleted_at", null).maybeSingle(),
  ) as CaseRef | null;
}

export async function getProcessCaseId(db: SupabaseClient, processId: string): Promise<string | null> {
  const row = unwrap(await db.from("legal_processes").select("id, legal_case_id").eq("id", processId).is("deleted_at", null).maybeSingle()) as {
    legal_case_id: string;
  } | null;
  return row?.legal_case_id ?? null;
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

export interface NewDocumentRow {
  id: string;
  client_id: string;
  category: string;
  title: string;
  description: string | null;
  visibility: "INTERNAL" | "PARTNER_VISIBLE";
  created_by: string;
}

/** Sem RETURNING: o id é gerado no servidor (o parceiro ainda não enxerga a linha). */
export async function insertDocument(db: SupabaseClient, row: NewDocumentRow): Promise<void> {
  const { error } = await db.from("documents").insert(row);
  if (error) throw fromDbError(error);
}

/** Vínculo com caso. Já vinculado = nada a fazer (idempotente). */
export async function linkCase(db: SupabaseClient, documentId: string, caseId: string, purpose: string | null): Promise<void> {
  const { error } = await db.from("case_documents").insert({ document_id: documentId, legal_case_id: caseId, purpose });
  if (error && error.code !== "23505") throw fromDbError(error);
}

export async function linkProcess(db: SupabaseClient, documentId: string, processId: string, purpose: string | null): Promise<void> {
  const { error } = await db.from("process_documents").insert({ document_id: documentId, legal_process_id: processId, purpose });
  if (error && error.code !== "23505") throw fromDbError(error);
}

export interface NewVersionRow {
  id: string;
  document_id: string;
  storage_object_name: string;
  original_filename: string;
  mime_type: string | null;
  file_size: number | null;
  source: "UPLOAD";
  created_by: string;
}

/** Sem RETURNING. Devolve "DUPLICATE" quando o id já existe (confirmação repetida). */
export async function insertVersion(db: SupabaseClient, row: NewVersionRow): Promise<"CREATED" | "DUPLICATE"> {
  const { error } = await db.from("document_versions").insert(row);
  if (!error) return "CREATED";
  if (error.code === "23505") return "DUPLICATE";
  throw fromDbError(error);
}

/** UPDATE com contagem: 0 linhas = não encontrado (ou sem acesso). */
async function updateDocument(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { error, count } = await db.from("documents").update(patch, { count: "exact" }).eq("id", id).is("deleted_at", null);
  if (error) throw fromDbError(error);
  return Boolean(count);
}

export const setVisibility = (db: SupabaseClient, id: string, visibility: "INTERNAL" | "PARTNER_VISIBLE") => updateDocument(db, id, { visibility });
export const setStatus = (db: SupabaseClient, id: string, status: "ACTIVE" | "ARCHIVED") => updateDocument(db, id, { status });
export const softDelete = (db: SupabaseClient, id: string) => updateDocument(db, id, { deleted_at: new Date().toISOString() });

/** Pendências de caso atendidas por alguma versão do documento. */
export async function countRequirementsSatisfiedBy(db: SupabaseClient, versionIds: string[]): Promise<number> {
  if (versionIds.length === 0) return 0;
  const { error, count } = await db
    .from("case_document_requirements")
    .select("id", { count: "exact", head: true })
    .in("satisfied_by_document_version_id", versionIds);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

/** Verificação (append-only). Só interno — e o interno lê de volta (RETURNING permitido). */
export async function insertVerification(
  db: SupabaseClient,
  row: { document_version_id: string; status: "VERIFIED" | "FAILED"; verified_by: string; notes: string | null },
): Promise<string> {
  const data = unwrap(await db.from("document_version_verifications").insert({ ...row, verification_source: "MANUAL" }).select("id").single()) as {
    id: string;
  };
  return data.id;
}

/**
 * Upload (026): com o JWT do usuário, o banco confere sessão, acesso ao
 * documento, documento ativo e versão ainda não registrada, e devolve o
 * caminho EXATO do objeto. Sem isto o servidor não assina.
 */
export async function authorizeUpload(db: SupabaseClient, documentId: string, versionId: string, filename: string): Promise<string> {
  return unwrap(await db.rpc("authorize_document_upload", { p_document_id: documentId, p_version_id: versionId, p_filename: filename })) as string;
}

/**
 * Download (026): com o JWT do usuário, o banco confere o acesso, registra o
 * acesso a dado pessoal (DOWNLOAD) e a auditoria DOCUMENT_DOWNLOADED (ator
 * USER, request_id) e devolve o caminho. Sem isto o servidor não assina.
 */
export async function authorizeDownload(db: SupabaseClient, versionId: string): Promise<string> {
  return unwrap(await db.rpc("authorize_document_download", { p_version_id: versionId })) as string;
}
