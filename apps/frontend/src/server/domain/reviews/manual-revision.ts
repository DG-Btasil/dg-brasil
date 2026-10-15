import { createHash } from "node:crypto";
import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { DomainError, notFound } from "@/server/core/errors";
import * as docsRepo from "@/server/domain/documents/repository";
import { signedDocumentStorage } from "@/server/domain/documents/signed-storage";
import { objectNameMatchesVersion, type DocumentStorage } from "@/server/domain/documents/storage";
import type { ManualRevisionDTO, ReviewContentDTO } from "./dto";
import { targetOf } from "./mappers";
import * as repo from "./repository";
import type { SaveManualRevisionInput } from "./schemas";

/**
 * Edição manual de conteúdo durante a revisão (4.3.1, migration 034).
 *
 * Regra: a versão em revisão é IMUTÁVEL. Salvar cria a versão N+1 (MANUAL_EDIT)
 * e uma revisão nova para ela; a revisão da N recebe "alterações pedidas"
 * (decisão append-only) e nada de aprovação é herdado.
 *
 * Fluxo: o BANCO autoriza e devolve o caminho exato (prepare_manual_revision)
 * → este service grava o texto nesse caminho (módulo de Storage existente,
 * write-once) → o banco registra versão + revisões + auditoria numa transação
 * (commit_manual_revision_once). Mesma chave = mesmo resultado; o preparo
 * avisa quando a chave já concluiu, e nada é enviado de novo.
 *
 * Só texto (minutas .md/.txt): PDF e DOCX continuam por "Enviar nova versão".
 * Nunca logar o conteúdo nem o caminho do arquivo: só ids.
 */

export const EDITABLE_MIME_TYPES = ["text/plain", "text/markdown"] as const;
/** Teto do arquivo editável (o texto é carregado inteiro no editor). */
export const MAX_EDITABLE_BYTES = 512 * 1024;
const OPEN_FOR_EDIT = ["PENDING", "REOPENED", "CHANGES_REQUESTED"];

export interface ManualRevisionDeps {
  storage?: DocumentStorage;
}
const storageOf = (deps?: ManualRevisionDeps) => deps?.storage ?? signedDocumentStorage();

export const editableMime = (mime: string | null | undefined): string | null => {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  return (EDITABLE_MIME_TYPES as readonly string[]).includes(base) ? base : null;
};

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

function requireEditor(ctx: ServiceContext, permission: "reviews.view" | "reviews.decide") {
  requireInternal(ctx);
  requirePermission(ctx, permission);
}

/**
 * Texto da versão em revisão, para o editor. Ler é acesso a dado pessoal:
 * passa por authorize_document_download (LGPD + auditoria, ator = usuário).
 */
export async function getReviewContent(ctx: ServiceContext, reviewId: string, deps?: ManualRevisionDeps): Promise<ReviewContentDTO> {
  requireEditor(ctx, "reviews.view");
  const row = await repo.getById(ctx.db, reviewId);
  if (!row) throw notFound("Revisão não encontrada.");
  const target = targetOf(row);
  if (target.kind !== "DOCUMENT_VERSION") return { kind: "UNAVAILABLE", reason: "NOT_DOCUMENT" };
  const version = await repo.getDocumentVersionTarget(ctx.db, target.id);
  if (!version || !version.storage_object_name) throw notFound("Arquivo não encontrado.");
  const mime = editableMime(version.mime_type);
  if (!mime) return { kind: "UNAVAILABLE", reason: "FORMAT" };
  if ((version.file_size ?? 0) > MAX_EDITABLE_BYTES) return { kind: "UNAVAILABLE", reason: "TOO_LARGE" };

  const path = await docsRepo.authorizeDownload(ctx.db, version.id);
  if (path !== version.storage_object_name) {
    ctx.log.error("review.content_path_mismatch", { reviewId, documentVersionId: version.id });
    throw new DomainError("INTERNAL");
  }
  const bytes = await storageOf(deps).downloadObject(path, MAX_EDITABLE_BYTES);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { kind: "UNAVAILABLE", reason: "FORMAT" };
  }
  ctx.log.info("review.content_read", { reviewId, documentVersionId: version.id });
  const readOnlyReason = !OPEN_FOR_EDIT.includes(row.status) ? "DECIDED" : one(version.documents)?.status === "ARCHIVED" ? "ARCHIVED" : undefined;
  return { kind: "TEXT", versionId: version.id, versionNumber: version.version_number, mimeType: mime, text, editable: !readOnlyReason, readOnlyReason };
}

/** sha256 hex do texto em UTF-8 (o mesmo que o banco guarda em checksum_sha256). */
export function contentChecksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Salva a edição como versão N+1 e devolve a revisão NOVA (a tela navega para ela). */
export async function saveManualRevision(ctx: ServiceContext, input: SaveManualRevisionInput, deps?: ManualRevisionDeps): Promise<ManualRevisionDTO> {
  requireEditor(ctx, "reviews.decide");
  const bytes = new TextEncoder().encode(input.content);
  if (bytes.byteLength > MAX_EDITABLE_BYTES) throw new DomainError("VALIDATION", "Texto longo demais para editar aqui: envie uma nova versão do arquivo.");
  const checksum = contentChecksum(bytes);

  const prepared = await repo.prepareManualRevision(ctx.db, input.idempotencyKey, input.reviewId, input.baseVersionId);
  if (prepared.deduplicated) {
    ctx.log.info("review.manual_revision_deduplicated", { reviewId: input.reviewId, documentVersionId: prepared.document_version_id });
    return {
      reviewId: prepared.review_id!,
      previousReviewId: prepared.previous_review_id ?? input.reviewId,
      versionId: prepared.document_version_id,
      versionNumber: prepared.version_number ?? 0,
      deduplicated: true,
    };
  }
  const objectName = prepared.object_name!;
  // Defesa em profundidade: o caminho autorizado pertence à versão nova.
  const segments = objectName.split("/");
  if (segments[0] !== "clients" || segments[2] !== "documents" || !objectNameMatchesVersion(objectName, segments[1], segments[3], prepared.document_version_id)) {
    ctx.log.error("review.manual_revision_path_mismatch", { reviewId: input.reviewId, documentVersionId: prepared.document_version_id });
    throw new DomainError("INTERNAL");
  }

  await storageOf(deps).uploadObject(objectName, bytes, prepared.mime_type ?? "text/plain");
  const committed = await repo.commitManualRevision(ctx.db, {
    key: input.idempotencyKey,
    reviewId: input.reviewId,
    baseVersionId: input.baseVersionId,
    versionId: prepared.document_version_id,
    objectName,
    size: bytes.byteLength,
    checksum,
  });
  ctx.log.info("review.manual_revision_saved", {
    reviewId: committed.review_id,
    previousReviewId: committed.previous_review_id,
    documentVersionId: committed.document_version_id,
  });
  return {
    reviewId: committed.review_id,
    previousReviewId: committed.previous_review_id,
    versionId: committed.document_version_id,
    versionNumber: committed.version_number,
    deduplicated: committed.deduplicated,
  };
}
