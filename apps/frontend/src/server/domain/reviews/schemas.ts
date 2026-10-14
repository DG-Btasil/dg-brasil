import { z } from "zod";
import { PRIORITIES, REVIEW_DECISIONS } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zIsoDateTime, zOptionalText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de revisão humana. Decisão no vocabulário do FRONT
 * (APPROVED, CHANGES_REQUESTED, REJECTED); o mapper traduz para o banco. O
 * status da revisão nunca é um campo de entrada: só muda por decide_review.
 */

export const REVIEW_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at", dueAt: "due_at" } as const;
export const REVIEW_TARGET_KINDS = ["DOCUMENT_VERSION", "ANALYSIS", "AGENT_PROPOSAL"] as const;
/** Status do banco + "OPEN" (PENDING ou REOPENED: aguardando decisão). */
export const REVIEW_STATUS_FILTERS = ["OPEN", "PENDING", "REOPENED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] as const;

export const listReviewsSchema = pageInputSchema
  .extend({
    status: z.enum(REVIEW_STATUS_FILTERS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    /** "me" = atribuídas a mim; "unassigned" = sem responsável; ou o id do revisor. */
    assignee: z.union([z.literal("me"), z.literal("unassigned"), zUuid()]).optional(),
    legalCaseId: zUuid().optional(),
    processId: zUuid().optional(),
    targetKind: z.enum(REVIEW_TARGET_KINDS).optional(),
  })
  .and(sortSchema(REVIEW_SORT_FIELDS, "createdAt"));
export type ListReviewsInput = z.infer<typeof listReviewsSchema>;

export const reviewIdSchema = z.object({ id: zUuid() });

/** Atribuição (grant de coluna: só responsável, prioridade e prazo). */
export const assignReviewSchema = z
  .object({
    id: zUuid(),
    assignedReviewerId: zUuid().nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    dueAt: zIsoDateTime().nullable().optional(),
  })
  .refine((v) => v.assignedReviewerId !== undefined || v.priority !== undefined || v.dueAt !== undefined, "Nada para alterar.");
export type AssignReviewInput = z.infer<typeof assignReviewSchema>;

/** Rejeitar e pedir alterações exigem justificativa (o banco também exige). */
export const decideReviewSchema = z
  .object({
    id: zUuid(),
    decision: z.enum(REVIEW_DECISIONS),
    notes: zOptionalText(5000),
  })
  .refine((v) => v.decision === "APPROVED" || !!v.notes, { message: "Informe a justificativa.", path: ["notes"] });
export type DecideReviewInput = z.infer<typeof decideReviewSchema>;

export const reopenReviewSchema = z.object({
  id: zUuid(),
  reason: zOptionalText(5000),
});
export type ReopenReviewInput = z.infer<typeof reopenReviewSchema>;
