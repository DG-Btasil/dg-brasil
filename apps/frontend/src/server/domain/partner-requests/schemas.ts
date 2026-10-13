import { z } from "zod";
import { PARTNER_REQUEST_STATUSES, PARTNER_REQUEST_TYPES } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zIsoDate, zOptionalText, zText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de solicitação a parceiro (validada no servidor, sempre).
 * Tipo no vocabulário do FRONT (DOCUMENT_REQUEST…); o mapper traduz para o banco.
 * O escritório parceiro NUNCA vem do navegador: é o parceiro operacional do caso.
 */

export const PARTNER_REQUEST_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at", dueAt: "due_at" } as const;

export const listPartnerRequestsSchema = pageInputSchema
  .extend({
    status: z.enum(PARTNER_REQUEST_STATUSES).optional(),
    type: z.enum(PARTNER_REQUEST_TYPES).optional(),
    legalCaseId: zUuid().optional(),
    /** Só equipe interna: para o parceiro a RLS já recorta o próprio escritório. */
    partnerOrganizationId: zUuid().optional(),
  })
  .and(sortSchema(PARTNER_REQUEST_SORT_FIELDS, "createdAt"));
export type ListPartnerRequestsInput = z.infer<typeof listPartnerRequestsSchema>;

export const partnerRequestIdSchema = z.object({ id: zUuid() });

export const createPartnerRequestSchema = z.object({
  legalCaseId: zUuid(),
  processId: zUuid().optional(),
  type: z.enum(PARTNER_REQUEST_TYPES),
  title: zText(200, "Informe o título da solicitação."),
  description: zOptionalText(5000),
  /** Prazo recomendado (data civil; não é prazo processual). */
  dueDate: zIsoDate().optional(),
});
export type CreatePartnerRequestInput = z.infer<typeof createPartnerRequestSchema>;

/**
 * Mensagem na conversa da solicitação. Parceiro: responder (OPEN → ANSWERED).
 * Interno: `reopen` devolve uma solicitação respondida para OPEN (pede nova resposta).
 */
export const addPartnerRequestMessageSchema = z.object({
  requestId: zUuid(),
  message: zText(5000, "Escreva a mensagem."),
  documentId: zUuid().optional(),
  reopen: z.boolean().default(false),
});
export type AddPartnerRequestMessageInput = z.infer<typeof addPartnerRequestMessageSchema>;

export const closePartnerRequestSchema = z.object({
  id: zUuid(),
  resolution: z.enum(["RESOLVED", "CANCELLED"]),
});
export type ClosePartnerRequestInput = z.infer<typeof closePartnerRequestSchema>;
