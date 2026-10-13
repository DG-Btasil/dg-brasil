import { randomUUID } from "node:crypto";
import { isPartner, requireAnyPermission, requireInternal, requirePermission, requireRole, type ServiceContext } from "@/server/core/context";
import { businessRule, conflict, DomainError, forbidden, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { ConfirmedUploadDTO, DocumentDetailDTO, DocumentListItem, DownloadUrlDTO, PreparedUploadDTO } from "./dto";
import {
  buildStatusIndex,
  currentVersionOf,
  downloadNameOf,
  internalDocumentFromRows,
  internalListItemFromRow,
  partnerDocumentFromRows,
  partnerListItemFromRow,
  type DocumentRow,
  type VersionRow,
} from "./mappers";
import * as repo from "./repository";
import type {
  ConfirmUploadInput,
  CreateDocumentInput,
  DownloadInput,
  LinkDocumentInput,
  ListDocumentsInput,
  PrepareUploadInput,
  SetVisibilityInput,
  VerifyVersionInput,
} from "./schemas";
import {
  DOWNLOAD_URL_TTL_SECONDS,
  LEGAL_DOCUMENTS_BUCKET,
  legalDocumentObjectName,
  objectNameMatchesVersion,
  sanitizeFilename,
  type DocumentStorage,
} from "./storage";
import { signedDocumentStorage } from "./signed-storage";

/**
 * Regras de Documento (lógico + versões imutáveis + vínculos + verificação).
 *
 * Autorização contextual aqui; RLS, triggers e funções do banco como segunda
 * barreira — as invariantes de dado (versão imutável, caminho no padrão,
 * documento e caso do mesmo cliente, verificação append-only) continuam NO
 * BANCO.
 *
 * Storage: o banco autoriza com o JWT do usuário e devolve o caminho
 * (authorize_document_upload/download, 026); só então `signed-storage.ts`
 * assina com a service role — o único uso dela no domínio, que nunca decide
 * acesso.
 *
 * Logs: só IDs. Nunca nome de arquivo, caminho no Storage, URL assinada,
 * título ou descrição.
 */

export interface DocumentDeps {
  /** Padrão: assinatura com a service role (signed-storage.ts). Injetável para teste. */
  storage?: DocumentStorage;
}

const storageOf = (deps?: DocumentDeps) => deps?.storage ?? signedDocumentStorage();

/** Recusa da RPC de autorização ("não encontrado") vira NOT_FOUND, nunca revela existência. */
async function authorized(promise: Promise<string>, notFoundMessage: string): Promise<string> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof DomainError && error.code === "FORBIDDEN" && /não encontrad/i.test(error.publicMessage)) throw notFound(notFoundMessage);
    throw error;
  }
}

/** O caminho devolvido pelo banco precisa ser o calculado aqui (mesma regra da 007). */
function assertSamePath(ctx: ServiceContext, fromDb: string, expected: string, ids: { documentId: string; versionId: string }) {
  if (fromDb !== expected) {
    ctx.log.error("document.object_name_mismatch", ids);
    throw new DomainError("INTERNAL");
  }
}

const DOC_NOT_FOUND = "Documento não encontrado.";

/** Ver documentos: equipe interna (documents.manage) ou portal do parceiro. */
function requireView(ctx: ServiceContext) {
  requireAnyPermission(ctx, "documents.manage", "partnerPortal.view");
}

/** Enviar arquivo / criar documento: interno com documents.manage; parceiro com partnerPortal.documents.submit. */
function requireSubmit(ctx: ServiceContext) {
  requirePermission(ctx, isPartner(ctx) ? "partnerPortal.documents.submit" : "documents.manage");
}

/** Gestão (visibilidade, verificação, vínculo, arquivamento): só equipe interna. */
function requireManage(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "documents.manage");
}

/**
 * Documento acessível ao usuário (RLS). Parceiro: só PARTNER_VISIBLE — a RLS
 * já garante; a conferência aqui é defesa em profundidade e responde
 * "não encontrado" (nunca revela que existe).
 */
async function loadDocument(ctx: ServiceContext, id: string): Promise<DocumentRow> {
  const row = await repo.getDocument(ctx.db, id);
  if (!row) throw notFound(DOC_NOT_FOUND);
  if (isPartner(ctx) && row.visibility !== "PARTNER_VISIBLE") throw notFound(DOC_NOT_FOUND);
  return row;
}

async function statusIndexFor(ctx: ServiceContext, versionIds: string[]) {
  const [verifications, approvals] = await Promise.all([
    repo.listVerificationStatus(ctx.db, versionIds),
    // Aprovação é dado interno (o parceiro nem lê revisões).
    isPartner(ctx) ? Promise.resolve([]) : repo.listApprovals(ctx.db, versionIds),
  ]);
  return buildStatusIndex(verifications, approvals);
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export async function listDocuments(ctx: ServiceContext, input: ListDocumentsInput): Promise<Page<DocumentListItem>> {
  requireView(ctx);
  const partner = isPartner(ctx);
  const scope: repo.DocumentScope = input.legalCaseId
    ? { kind: "case", id: input.legalCaseId }
    : input.legalProcessId
      ? { kind: "process", id: input.legalProcessId }
      : { kind: "client", id: input.clientId as string };
  const { rows, total } = await repo.listDocuments(
    ctx.db,
    scope,
    // Parceiro não filtra por visibilidade: só recebe PARTNER_VISIBLE (RLS).
    { category: input.category, status: input.status, visibility: partner ? undefined : input.visibility },
    input,
    { column: input.column, ascending: input.ascending },
  );
  const versions = await repo.listVersions(
    ctx.db,
    rows.map((r) => r.id),
  );
  const currentByDoc = new Map<string, VersionRow>();
  for (const v of versions) {
    const best = currentByDoc.get(v.document_id);
    if (!best || v.version_number > best.version_number) currentByDoc.set(v.document_id, v);
  }
  const index = await statusIndexFor(ctx, [...currentByDoc.values()].map((v) => v.id));
  const items: DocumentListItem[] = rows.map((row) =>
    partner
      ? { surface: "PARTNER" as const, ...partnerListItemFromRow(row, currentByDoc.get(row.id), index) }
      : { surface: "INTERNAL" as const, ...internalListItemFromRow(row, currentByDoc.get(row.id), index) },
  );
  return toPage(items, total, input);
}

/** Documento com todas as versões, verificação atual por versão e (interno) aprovação. */
export async function getDocument(ctx: ServiceContext, id: string): Promise<DocumentDetailDTO> {
  requireView(ctx);
  const row = await loadDocument(ctx, id);
  const [versions, links] = await Promise.all([repo.listVersions(ctx.db, [id]), repo.getLinks(ctx.db, id)]);
  const index = await statusIndexFor(
    ctx,
    versions.map((v) => v.id),
  );
  if (isPartner(ctx)) return { surface: "PARTNER", document: partnerDocumentFromRows(row, versions, index, links) };
  return { surface: "INTERNAL", document: internalDocumentFromRows(row, versions, index, links) };
}

/* ------------------------------------------------------------------ */
/* Documento lógico + vínculo                                          */
/* ------------------------------------------------------------------ */

/** Caso (e processo) de destino. O cliente do documento é SEMPRE o do caso. */
async function resolveTarget(ctx: ServiceContext, input: { legalCaseId?: string; legalProcessId?: string }) {
  let caseId = input.legalCaseId;
  if (input.legalProcessId) {
    const processCaseId = await repo.getProcessCaseId(ctx.db, input.legalProcessId);
    if (!processCaseId) throw notFound("Processo não encontrado.");
    if (caseId && caseId !== processCaseId) throw validation({ legalProcessId: ["O processo não pertence a este caso."] });
    caseId = processCaseId;
  }
  if (!caseId) return null;
  const caseRef = await repo.getCaseRef(ctx.db, caseId);
  if (!caseRef) throw notFound("Caso não encontrado.");
  return caseRef;
}

/**
 * Cria o documento lógico (id gerado no servidor) e o vincula ao caso/processo.
 * Parceiro: caso/processo do próprio escritório obrigatório; nasce
 * PARTNER_VISIBLE; inserts sem RETURNING (README). O arquivo vem depois
 * (`prepareUpload` → upload → `confirmUpload`).
 */
export async function createDocument(ctx: ServiceContext, input: CreateDocumentInput): Promise<{ id: string }> {
  requireSubmit(ctx);
  const partner = isPartner(ctx);
  if (partner && !input.legalCaseId && !input.legalProcessId) {
    throw validation({ legalCaseId: ["Informe o caso ou o processo do documento."] });
  }
  if (partner && input.visibility === "INTERNAL") throw forbidden("Documento enviado pelo parceiro é sempre compartilhado com o escritório.");

  const caseRef = await resolveTarget(ctx, input);
  if (caseRef && input.clientId && input.clientId !== caseRef.client_id) {
    throw validation({ clientId: ["O cliente informado não é o cliente do caso."] });
  }
  const clientId = caseRef?.client_id ?? input.clientId;
  if (!clientId) throw validation({ clientId: ["Informe o cliente, o caso ou o processo."] });

  const id = randomUUID();
  await repo.insertDocument(ctx.db, {
    id,
    client_id: clientId,
    category: input.category,
    title: input.title,
    description: input.description ?? null,
    visibility: partner ? "PARTNER_VISIBLE" : (input.visibility ?? "INTERNAL"),
    created_by: ctx.session.userId,
  });

  try {
    if (caseRef) await repo.linkCase(ctx.db, id, caseRef.id, input.purpose ?? null);
    if (input.legalProcessId) await repo.linkProcess(ctx.db, id, input.legalProcessId, input.purpose ?? null);
  } catch (error) {
    // Sem transação entre os dois inserts (PostgREST). Interno desfaz com
    // exclusão lógica; o documento do parceiro sem vínculo fica invisível a ele
    // (a RLS exige o vínculo) e aparece só para a equipe interna.
    if (!partner) await repo.softDelete(ctx.db, id).catch(() => false);
    ctx.log.warn("document.link_failed", { documentId: id, legalCaseId: caseRef?.id, legalProcessId: input.legalProcessId });
    throw error;
  }

  ctx.log.info("document.created", { documentId: id, clientId, legalCaseId: caseRef?.id, legalProcessId: input.legalProcessId });
  return { id };
}

/** Vincula documento existente a outro caso/processo do MESMO cliente (o trigger do banco confere). */
export async function linkDocument(ctx: ServiceContext, input: LinkDocumentInput): Promise<void> {
  requireManage(ctx);
  const doc = await loadDocument(ctx, input.documentId);
  const caseRef = await resolveTarget(ctx, input);
  if (!caseRef) throw validation({ legalCaseId: ["Informe o caso ou o processo."] });
  if (caseRef.client_id !== doc.client_id) throw businessRule("O documento é de outro cliente.");
  await repo.linkCase(ctx.db, doc.id, caseRef.id, input.purpose ?? null);
  if (input.legalProcessId) await repo.linkProcess(ctx.db, doc.id, input.legalProcessId, input.purpose ?? null);
  ctx.log.info("document.linked", { documentId: doc.id, legalCaseId: caseRef.id, legalProcessId: input.legalProcessId });
}

/* ------------------------------------------------------------------ */
/* Upload: prepare → (navegador envia o arquivo) → confirm              */
/* ------------------------------------------------------------------ */

function assertAcceptsVersions(doc: DocumentRow) {
  if (doc.status === "ARCHIVED") throw invalidState("Documento arquivado não recebe nova versão.");
}

/**
 * Passo 1. Autoriza (sessão, permissão, documento acessível pela RLS), gera o
 * id da versão NO SERVIDOR e pede ao banco, com o JWT do usuário, o caminho
 * autorizado (authorize_document_upload). Só com o caminho do banco — igual
 * ao calculado aqui — a URL de upload é assinada (service role).
 */
export async function prepareUpload(ctx: ServiceContext, input: PrepareUploadInput, deps?: DocumentDeps): Promise<PreparedUploadDTO> {
  requireSubmit(ctx);
  const doc = await loadDocument(ctx, input.documentId);
  assertAcceptsVersions(doc);
  const versionId = randomUUID();
  const expected = legalDocumentObjectName(doc.client_id, doc.id, versionId, input.fileName);
  const path = await authorized(repo.authorizeUpload(ctx.db, doc.id, versionId, input.fileName), DOC_NOT_FOUND);
  assertSamePath(ctx, path, expected, { documentId: doc.id, versionId });
  const upload = await storageOf(deps).createSignedUploadUrl(path);
  ctx.log.info("document.upload_prepared", { documentId: doc.id, versionId });
  return { documentId: doc.id, versionId, signedUrl: upload.signedUrl, token: upload.token, bucket: LEGAL_DOCUMENTS_BUCKET, path };
}

/** A versão já registrada é ESTA (mesmo documento e mesmo objeto)? */
async function existingConfirmation(ctx: ServiceContext, versionId: string, documentId: string, path: string): Promise<boolean> {
  const existing = await repo.getVersion(ctx.db, versionId);
  if (!existing) return false;
  if (existing.document_id !== documentId || existing.storage_object_name !== path) throw conflict("Esta versão já foi registrada para outro arquivo.");
  return true;
}

/**
 * Passo 2. Registra `document_versions` (JWT do usuário) com o id do passo 1.
 * Idempotente: o id da versão é a chave natural — confirmar duas vezes não
 * cria duas versões. O caminho é recalculado aqui e reautorizado pelo banco;
 * o objeto precisa existir (consulta pela service role, só desse caminho) e
 * tamanho/tipo vêm do Storage, não do navegador.
 */
export async function confirmUpload(ctx: ServiceContext, input: ConfirmUploadInput, deps?: DocumentDeps): Promise<ConfirmedUploadDTO> {
  requireSubmit(ctx);
  const doc = await loadDocument(ctx, input.documentId);
  const versionId = input.versionId.toLowerCase();
  const expected = legalDocumentObjectName(doc.client_id, doc.id, versionId, input.fileName);
  const already = { documentId: doc.id, versionId, alreadyConfirmed: true };

  if (await existingConfirmation(ctx, versionId, doc.id, expected)) return already;
  assertAcceptsVersions(doc);

  let path: string;
  try {
    path = await authorized(repo.authorizeUpload(ctx.db, doc.id, versionId, input.fileName), DOC_NOT_FOUND);
  } catch (error) {
    // "Versão já registrada" (corrida com outra confirmação).
    if (error instanceof DomainError && error.code === "CONFLICT" && (await existingConfirmation(ctx, versionId, doc.id, expected))) return already;
    throw error;
  }
  assertSamePath(ctx, path, expected, { documentId: doc.id, versionId });

  const info = await storageOf(deps).getObjectInfo(path);
  if (!info) throw invalidState("O arquivo ainda não chegou. Envie o arquivo e confirme de novo.");

  const result = await repo.insertVersion(ctx.db, {
    id: versionId,
    document_id: doc.id,
    storage_object_name: path,
    original_filename: input.fileName,
    mime_type: info.contentType ?? input.mimeType ?? null,
    file_size: info.sizeBytes ?? null,
    source: "UPLOAD",
    created_by: ctx.session.userId,
  });
  if (result === "DUPLICATE") {
    // Corrida (duplo clique): a outra confirmação venceu.
    if (await existingConfirmation(ctx, versionId, doc.id, path)) return already;
    throw conflict("Esta versão já foi registrada para outro arquivo.");
  }
  ctx.log.info("document.version_created", { documentId: doc.id, versionId });
  return { documentId: doc.id, versionId, alreadyConfirmed: false };
}

/* ------------------------------------------------------------------ */
/* Download                                                            */
/* ------------------------------------------------------------------ */

/**
 * URL assinada (60 s) para UMA versão.
 *
 *   1. sessão + permissão (documents.manage | partnerPortal.view);
 *   2. documento acessível pela RLS (parceiro: só PARTNER_VISIBLE de caso/processo
 *      dele — senão "não encontrado") e versão do próprio documento (IDOR);
 *   3. authorize_document_download com o JWT do usuário: o banco confere o
 *      acesso de novo, registra o acesso a dado pessoal (DOWNLOAD) e a
 *      auditoria DOCUMENT_DOWNLOADED (ator USER, request_id) e devolve o caminho;
 *   4. só então a URL é assinada (service role, signed-storage.ts).
 */
export async function downloadDocument(ctx: ServiceContext, input: DownloadInput, deps?: DocumentDeps): Promise<DownloadUrlDTO> {
  requireView(ctx);
  const doc = await loadDocument(ctx, input.documentId);

  let version: VersionRow | undefined;
  if (input.versionId) {
    const found = await repo.getVersion(ctx.db, input.versionId);
    // Versão de OUTRO documento = não encontrado (IDOR por id de versão).
    version = found && found.document_id === doc.id ? found : undefined;
  } else {
    version = currentVersionOf(await repo.listVersions(ctx.db, [doc.id]));
  }
  if (!version) throw notFound("Arquivo não encontrado.");
  const ids = { documentId: doc.id, versionId: version.id };
  if (!objectNameMatchesVersion(version.storage_object_name, doc.client_id, doc.id, version.id)) {
    ctx.log.error("document.object_name_mismatch", ids);
    throw new DomainError("INTERNAL");
  }

  const path = await authorized(repo.authorizeDownload(ctx.db, version.id), "Arquivo não encontrado.");
  assertSamePath(ctx, path, version.storage_object_name, ids);
  const url = await storageOf(deps).createSignedDownloadUrl(path, DOWNLOAD_URL_TTL_SECONDS, downloadNameOf(version, sanitizeFilename));
  ctx.log.info("document.downloaded", ids);
  return { ...ids, url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
}

/* ------------------------------------------------------------------ */
/* Gestão interna                                                      */
/* ------------------------------------------------------------------ */

/**
 * Compartilhar com o parceiro (PARTNER_VISIBLE) ou recolher (INTERNAL).
 * Regras para compartilhar: documento ligado a caso de PARCEIRO; tem arquivo;
 * a versão atual não foi rejeitada em revisão; minuta de agente só depois de
 * APROVADA ("IA executa. Humano decide.").
 */
export async function setVisibility(ctx: ServiceContext, input: SetVisibilityInput): Promise<void> {
  requireManage(ctx);
  const doc = await loadDocument(ctx, input.id);
  if (doc.visibility === input.visibility) return;
  if (input.visibility === "PARTNER_VISIBLE") {
    if (!(await repo.hasPartnerCaseLink(ctx.db, doc.id))) throw businessRule("Somente documentos de casos de parceiros podem ser disponibilizados.");
    const current = currentVersionOf(await repo.listVersions(ctx.db, [doc.id]));
    if (!current) throw businessRule("Envie o arquivo antes de disponibilizar o documento.");
    const approval = (await repo.listApprovals(ctx.db, [current.id]))[0]?.approval_status ?? "PENDING";
    if (approval === "REJECTED") throw businessRule("A versão atual foi rejeitada em revisão e não pode ser disponibilizada.");
    if (current.source === "AGENT" && approval !== "APPROVED") throw businessRule("Minuta gerada por agente só é disponibilizada depois de aprovada em revisão.");
  }
  if (!(await repo.setVisibility(ctx.db, doc.id, input.visibility))) throw notFound(DOC_NOT_FOUND);
  ctx.log.info("document.visibility_changed", { documentId: doc.id, visibility: input.visibility });
}

export async function setArchived(ctx: ServiceContext, input: { id: string; archived: boolean }): Promise<void> {
  requireManage(ctx);
  if (!(await repo.setStatus(ctx.db, input.id, input.archived ? "ARCHIVED" : "ACTIVE"))) throw notFound(DOC_NOT_FOUND);
  ctx.log.info("document.status_changed", { documentId: input.id, archived: input.archived });
}

/** Exclusão lógica (ADMIN). Versões e objetos ficam (imutáveis); nada é apagado do Storage. */
export async function removeDocument(ctx: ServiceContext, id: string): Promise<void> {
  requireManage(ctx);
  requireRole(ctx, "ADMIN");
  const doc = await loadDocument(ctx, id);
  const versions = await repo.listVersions(ctx.db, [doc.id]);
  if (
    (await repo.countRequirementsSatisfiedBy(
      ctx.db,
      versions.map((v) => v.id),
    )) > 0
  ) {
    throw invalidState("O documento atende a uma pendência de caso. Troque a versão da pendência antes de excluir.");
  }
  if (!(await repo.softDelete(ctx.db, doc.id))) throw notFound(DOC_NOT_FOUND);
  ctx.log.info("document.deleted", { documentId: doc.id });
}

/** Verificação do ARQUIVO (append-only, por versão). Versão nova nasce UNVERIFIED. */
export async function verifyVersion(ctx: ServiceContext, input: VerifyVersionInput): Promise<{ id: string }> {
  requireManage(ctx);
  const version = await repo.getVersion(ctx.db, input.versionId);
  if (!version) throw notFound("Versão não encontrada.");
  await loadDocument(ctx, version.document_id);
  const id = await repo.insertVerification(ctx.db, {
    document_version_id: version.id,
    status: input.status,
    verified_by: ctx.session.userId,
    notes: input.notes ?? null,
  });
  ctx.log.info("document.version_verified", { documentId: version.document_id, versionId: version.id, verificationId: id, status: input.status });
  return { id };
}
