import { z } from "zod";
import { DEADLINE_STATUSES, DEADLINE_TYPES, HEARING_MODES } from "@/lib/constants/status";
import { pageInputSchema } from "@/server/core/pagination";
import { zIsoDate, zIsoDateTime, zOptionalText, zText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de Prazo. Status gravados: OPEN, COMPLETED, CANCELLED,
 * MISSED. "Vencido" (OVERDUE) NUNCA é gravado: é OPEN com vencimento no
 * passado, lido do banco (views `deadline_status` e `deadline_agenda`).
 */

export const DEADLINE_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type DeadlinePriority = (typeof DEADLINE_PRIORITIES)[number];

/** Situação efetiva (banco): status gravado + OVERDUE derivado. */
export const DEADLINE_EFFECTIVE_STATUSES = ["OPEN", "OVERDUE", "COMPLETED", "CANCELLED", "MISSED"] as const;
export type DeadlineEffectiveStatus = (typeof DEADLINE_EFFECTIVE_STATUSES)[number];

export const deadlineIdSchema = z.object({ id: zUuid() });

const scopeFilters = {
  caseId: zUuid().optional(),
  processId: zUuid().optional(),
  /** Responsável: UUID de usuário interno ou "me" (o próprio usuário da sessão). */
  responsibleUserId: z.union([z.literal("me"), zUuid()]).optional(),
};

/**
 * Prazos de um caso, de um processo ou do escritório inteiro (agenda), por
 * vencimento. `status` é o gravado (OPEN inclui os vencidos); `effectiveStatus`
 * separa "no prazo" (OPEN) de "vencido" (OVERDUE). Datas são do fuso do
 * escritório, inclusivas.
 */
export const listDeadlinesSchema = pageInputSchema.extend({
  ...scopeFilters,
  effectiveStatus: z.enum(DEADLINE_EFFECTIVE_STATUSES).optional(),
  status: z.enum(DEADLINE_STATUSES).optional(),
  type: z.enum(DEADLINE_TYPES).optional(),
  fromDate: zIsoDate().optional(),
  untilDate: zIsoDate().optional(),
  /** Só prazos que nasceram de proposta de agente e ainda não foram conferidos. */
  agentUnchecked: z.boolean().optional(),
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
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
 * Vencimento: `dueAt` (data/hora com fuso) OU `dueDate` (data civil). Com
 * `dueTime` (HH:MM, horário de Brasília) a data civil ganha hora, como na
 * audiência; sem ele, vira 23:59:59 em Brasília.
 */
const dueFields = {
  dueAt: zIsoDateTime().optional(),
  dueDate: zIsoDate().optional(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida.")
    .optional(),
};

/** Audiência: modalidade, local e link. Só valem com o tipo "Audiência". */
const hearingLink = z
  .string()
  .trim()
  .max(1000, "Máximo de 1000 caracteres.")
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Informe um link que comece com http:// ou https://.")
  .transform((v) => (v ? v : undefined))
  .optional();
const hearingFields = {
  hearingMode: z.enum(HEARING_MODES).optional(),
  hearingLocation: zOptionalText(500),
  hearingLink,
};

export const createDeadlineSchema = z
  .object({
    /**
     * Chave de envio (UUID) gerada pela tela UMA vez por intenção de envio;
     * nova tentativa da mesma intenção reutiliza a mesma chave (migrations 027 e 063).
     */
    idempotencyKey: zUuid(),
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
    ...hearingFields,
  })
  .refine((v) => (v.dueAt === undefined) !== (v.dueDate === undefined), { message: "Informe o vencimento.", path: ["dueDate"] })
  .refine((v) => v.dueTime === undefined || v.dueDate !== undefined, { message: "Informe a data junto com a hora.", path: ["dueTime"] });
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
      hearingMode: z.enum(HEARING_MODES).nullable(),
      hearingLocation: zOptionalText(500).nullable(),
      hearingLink: hearingLink.nullable(),
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, "Nada para alterar.")
    .refine((p) => p.dueAt === undefined || p.dueDate === undefined, { message: "Informe só uma forma de vencimento.", path: ["dueDate"] })
    .refine((p) => p.dueTime === undefined || p.dueDate !== undefined, { message: "Informe a data junto com a hora.", path: ["dueTime"] }),
});
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;

/** Cancelar: o motivo é obrigatório (o banco também exige, migration 063). */
export const cancelDeadlineSchema = z.object({ id: zUuid(), reason: zText(1000, "Informe o motivo do cancelamento.") });
export type CancelDeadlineInput = z.infer<typeof cancelDeadlineSchema>;

/** Prazo perdido: a observação é opcional. */
export const missDeadlineSchema = z.object({ id: zUuid(), reason: zOptionalText(1000) });
export type MissDeadlineInput = z.infer<typeof missDeadlineSchema>;

/** Reabrir prazo cumprido, cancelado ou perdido: o motivo é obrigatório. */
export const reopenDeadlineSchema = z.object({ id: zUuid(), reason: zText(1000, "Informe o motivo para reabrir o prazo.") });
export type ReopenDeadlineInput = z.infer<typeof reopenDeadlineSchema>;
