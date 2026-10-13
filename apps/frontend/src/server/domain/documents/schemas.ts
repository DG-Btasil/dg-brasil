import { z } from "zod";
import { DOCUMENT_VISIBILITIES } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zOptionalText, zText, zUuid } from "@/server/core/validation";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./storage";

/** Entrada das operações de documento (validada no servidor, sempre). */

/** Categoria: código do catálogo `document_categories` (domínio do banco). A FK confere se existe. */
export const zDocumentCategory = () =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Categoria inválida.");

/** Nome do arquivo como veio do navegador (o caminho no Storage usa a versão sanitizada). */
export const zFileName = () =>
  zText(255, "Informe o nome do arquivo.").refine((v) => ![...v].some((c) => c.charCodeAt(0) < 32 || c === "/" || c === "\\"), "Nome de arquivo inválido.");

export const DOCUMENT_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at", title: "title" } as const;

/** Escopo da listagem: exatamente um entre cliente, caso e processo. */
const scopeCount = (v: { clientId?: string; legalCaseId?: string; legalProcessId?: string }) =>
  [v.clientId, v.legalCaseId, v.legalProcessId].filter(Boolean).length;

export const listDocumentsSchema = pageInputSchema
  .extend({
    clientId: zUuid().optional(),
    legalCaseId: zUuid().optional(),
    legalProcessId: zUuid().optional(),
    category: zDocumentCategory().optional(),
    /** Só equipe interna: parceiro só recebe PARTNER_VISIBLE (RLS). */
    visibility: z.enum(DOCUMENT_VISIBILITIES).optional(),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .refine((v) => scopeCount(v) === 1, { message: "Informe o cliente, o caso ou o processo.", path: ["clientId"] })
  .and(sortSchema(DOCUMENT_SORT_FIELDS, "updatedAt"));
export type ListDocumentsInput = z.infer<typeof listDocumentsSchema>;

export const documentIdSchema = z.object({ id: zUuid() });

/**
 * Documento lógico + vínculo. Interno: cliente, caso ou processo (o cliente é
 * derivado do caso/processo). Parceiro: caso ou processo do próprio escritório
 * (obrigatório) — visibilidade sempre PARTNER_VISIBLE.
 */
export const createDocumentSchema = z
  .object({
    clientId: zUuid().optional(),
    legalCaseId: zUuid().optional(),
    legalProcessId: zUuid().optional(),
    category: zDocumentCategory(),
    title: zText(200, "Informe o título do documento."),
    description: zOptionalText(2000),
    /** Só equipe interna. Padrão: INTERNAL. */
    visibility: z.enum(DOCUMENT_VISIBILITIES).optional(),
    /** Finalidade do vínculo com o caso/processo (texto curto). */
    purpose: zOptionalText(200),
  })
  .refine((v) => scopeCount(v) >= 1, { message: "Informe o cliente, o caso ou o processo.", path: ["clientId"] });
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/** Vincula documento existente a outro caso/processo do mesmo cliente (interno). */
export const linkDocumentSchema = z
  .object({
    documentId: zUuid(),
    legalCaseId: zUuid().optional(),
    legalProcessId: zUuid().optional(),
    purpose: zOptionalText(200),
  })
  .refine((v) => Boolean(v.legalCaseId) !== Boolean(v.legalProcessId), { message: "Informe o caso ou o processo.", path: ["legalCaseId"] });
export type LinkDocumentInput = z.infer<typeof linkDocumentSchema>;

/** Passo 1 do upload: autoriza e devolve a URL assinada para UMA versão nova. */
export const prepareUploadSchema = z.object({
  documentId: zUuid(),
  fileName: zFileName(),
  mimeType: z.enum(ALLOWED_MIME_TYPES, { message: "Tipo de arquivo não aceito." }),
  sizeBytes: z.number().int().min(1, "Arquivo vazio.").max(MAX_FILE_SIZE_BYTES, "Arquivo maior que o limite de 50 MB."),
});
export type PrepareUploadInput = z.infer<typeof prepareUploadSchema>;

/**
 * Passo 2 do upload: registra a versão com o id gerado no passo 1. O caminho é
 * recalculado no servidor (o navegador nunca escolhe o caminho).
 */
export const confirmUploadSchema = z.object({
  documentId: zUuid(),
  versionId: zUuid(),
  fileName: zFileName(),
  mimeType: z.enum(ALLOWED_MIME_TYPES, { message: "Tipo de arquivo não aceito." }).optional(),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;

/** Download: versão específica ou a atual do documento. */
export const downloadSchema = z.object({
  documentId: zUuid(),
  versionId: zUuid().optional(),
});
export type DownloadInput = z.infer<typeof downloadSchema>;

export const setVisibilitySchema = z.object({
  id: zUuid(),
  visibility: z.enum(DOCUMENT_VISIBILITIES),
});
export type SetVisibilityInput = z.infer<typeof setVisibilitySchema>;

export const setArchivedSchema = z.object({
  id: zUuid(),
  archived: z.boolean(),
});

/** Verificação do arquivo (append-only): nova linha a cada conferência. */
export const verifyVersionSchema = z.object({
  versionId: zUuid(),
  status: z.enum(["VERIFIED", "FAILED"]),
  notes: zOptionalText(1000),
});
export type VerifyVersionInput = z.infer<typeof verifyVersionSchema>;
