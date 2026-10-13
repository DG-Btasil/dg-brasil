import { z } from "zod";
import { pageInputSchema } from "@/server/core/pagination";
import { zText, zUuid } from "@/server/core/validation";
import { zDocumentCategory } from "../schemas";

/**
 * Pendências de documento do caso (`case_document_requirements`): "o que falta".
 * Não é documento: é satisfeita por uma VERSÃO concreta de documento.
 */

export const REQUIREMENT_STATUSES = ["MISSING", "REQUESTED", "RECEIVED", "APPROVED", "REJECTED"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const listRequirementsSchema = pageInputSchema.extend({
  legalCaseId: zUuid(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
});
export type ListRequirementsInput = z.infer<typeof listRequirementsSchema>;

export const createRequirementSchema = z.object({
  legalCaseId: zUuid(),
  label: zText(200, "Descreva o documento pendente."),
  category: zDocumentCategory(),
  required: z.boolean().default(true),
  /** true = já nasce REQUESTED (pedido feito ao cliente/parceiro). */
  requestNow: z.boolean().default(false),
});
export type CreateRequirementInput = z.infer<typeof createRequirementSchema>;

export const requirementIdSchema = z.object({ id: zUuid() });

export const satisfyRequirementSchema = z.object({
  id: zUuid(),
  documentVersionId: zUuid(),
});
export type SatisfyRequirementInput = z.infer<typeof satisfyRequirementSchema>;
