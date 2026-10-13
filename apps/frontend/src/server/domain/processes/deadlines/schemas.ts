import { z } from "zod";
import { DEADLINE_TYPES } from "@/lib/constants/status";
import { pageInputSchema } from "@/server/core/pagination";
import { zIsoDate, zIsoDateTime, zOptionalText, zText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de Prazo. Status gravados: OPEN, COMPLETED, CANCELLED,
 * MISSED. "Vencido" (OVERDUE) NUNCA é gravado: é OPEN com vencimento no
 * passado, lido da view `deadline_status`.
 */

export const DEADLINE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type DeadlinePriority = (typeof DEADLINE_PRIORITIES)[number];

/** Situação efetiva (view deadline_status): status gravado + OVERDUE derivado. */
export const DEADLINE_EFFECTIVE_STATUSES = ["OPEN", "OVERDUE", "COMPLETED", "CANCELLED", "MISSED"] as const;
export type DeadlineEffectiveStatus = (typeof DEADLINE_EFFECTIVE_STATUSES)[number];

export const deadlineIdSchema = z.object({ id: zUuid() });

const scopeFilters = {
  caseId: zUuid().optional(),
  processId: zUuid().optional(),
  /** Responsável: UUID de usuário interno ou "me" (o próprio usuário da sessão). */
  responsibleUserId: z.union([z.literal("me"), zUuid()]).optional(),
};

/** Prazos de um caso/processo (qualquer situação), por vencimento. */
export const listDeadlinesSchema = pageInputSchema.extend({
  ...scopeFilters,
  effectiveStatus: z.enum(DEADLINE_EFFECTIVE_STATUSES).optional(),
});
export type ListDeadlinesInput = z.infer<typeof listDeadlinesSchema>;

/** Em aberto e ainda no prazo, vencendo nos próximos `days` dias (data local de São Paulo). */
export const listUpcomingSchema = pageInputSchema.extend({
  ...scopeFilters,
  days: z.coerce.number().int().min(1).max(365).default(30),
});
export type ListUpcomingInput = z.infer<typeof listUpcomingSchema>;

/** Em aberto e vencidos (derivado), mais antigos primeiro. */
export const listOverdueSchema = pageInputSchema.extend(scopeFilters);
export type ListOverdueInput = z.infer<typeof listOverdueSchema>;

/**
 * Vencimento: `dueAt` (data/hora com fuso) OU `dueDate` (data civil — vira
 * 23:59:59 no horário de Brasília). Exatamente um dos dois.
 */
const dueFields = {
  dueAt: zIsoDateTime().optional(),
  dueDate: zIsoDate().optional(),
};

export const createDeadlineSchema = z
  .object({
    /** Prazo SEMPRE pertence a um caso; o processo é opcional (e precisa ser do mesmo caso). */
    legalCaseId: zUuid(),
    processId: zUuid().optional(),
    title: zText(300, "Informe o título do prazo."),
    type: z.enum(DEADLINE_TYPES).default("INTERNAL"),
    description: zOptionalText(5000),
    ...dueFields,
    priority: z.enum(DEADLINE_PRIORITIES).default("NORMAL"),
    /** Sem responsável informado, fica com quem cadastrou. */
    responsibleUserId: zUuid().optional(),
  })
  .refine((v) => (v.dueAt === undefined) !== (v.dueDate === undefined), { message: "Informe o vencimento.", path: ["dueDate"] });
export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;

/** Edição (só prazo em aberto). Caso e processo não mudam. */
export const updateDeadlineSchema = z.object({
  id: zUuid(),
  patch: z
    .object({
      title: zText(300, "Informe o título do prazo."),
      type: z.enum(DEADLINE_TYPES),
      description: zOptionalText(5000).nullable(),
      ...dueFields,
      priority: z.enum(DEADLINE_PRIORITIES),
      responsibleUserId: zUuid().nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar.")
    .refine((p) => p.dueAt === undefined || p.dueDate === undefined, { message: "Informe só uma forma de vencimento.", path: ["dueDate"] }),
});
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;
