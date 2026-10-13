"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  confirmUploadSchema,
  createDocumentSchema,
  documentIdSchema,
  downloadSchema,
  linkDocumentSchema,
  listDocumentsSchema,
  prepareUploadSchema,
  setArchivedSchema,
  setVisibilitySchema,
  verifyVersionSchema,
} from "./schemas";

/**
 * Server Actions de Documento — a única porta do navegador para este domínio.
 * Cada uma: sessão + permissão (runAction) → Zod → service. A permissão fina
 * (interno × parceiro) é conferida no service, porque depende da superfície.
 *
 * URLs assinadas (upload/download) saem só no `data` do resultado: nunca em
 * log. O Storage é chamado com o JWT do usuário (client da action).
 */

export async function listDocumentsAction(input: unknown) {
  return runAction({ name: "documents.list", schema: listDocumentsSchema, input, handler: service.listDocuments });
}

export async function getDocumentAction(input: unknown) {
  return runAction({ name: "documents.get", schema: documentIdSchema, input, handler: (ctx, { id }) => service.getDocument(ctx, id) });
}

export async function createDocumentAction(input: unknown) {
  return runAction({ name: "documents.create", schema: createDocumentSchema, input, handler: service.createDocument });
}

export async function linkDocumentAction(input: unknown) {
  return runAction({ name: "documents.link", permission: "documents.manage", schema: linkDocumentSchema, input, handler: service.linkDocument });
}

export async function prepareDocumentUploadAction(input: unknown) {
  return runAction({ name: "documents.upload_prepare", schema: prepareUploadSchema, input, handler: (ctx, data) => service.prepareUpload(ctx, data) });
}

export async function confirmDocumentUploadAction(input: unknown) {
  return runAction({ name: "documents.upload_confirm", schema: confirmUploadSchema, input, handler: (ctx, data) => service.confirmUpload(ctx, data) });
}

export async function downloadDocumentAction(input: unknown) {
  return runAction({ name: "documents.download", schema: downloadSchema, input, handler: (ctx, data) => service.downloadDocument(ctx, data) });
}

export async function setDocumentVisibilityAction(input: unknown) {
  return runAction({ name: "documents.visibility", permission: "documents.manage", schema: setVisibilitySchema, input, handler: service.setVisibility });
}

export async function setDocumentArchivedAction(input: unknown) {
  return runAction({ name: "documents.archive", permission: "documents.manage", schema: setArchivedSchema, input, handler: service.setArchived });
}

export async function removeDocumentAction(input: unknown) {
  return runAction({ name: "documents.remove", permission: "documents.manage", schema: documentIdSchema, input, handler: (ctx, { id }) => service.removeDocument(ctx, id) });
}

export async function verifyDocumentVersionAction(input: unknown) {
  return runAction({ name: "documents.verify", permission: "documents.manage", schema: verifyVersionSchema, input, handler: service.verifyVersion });
}
