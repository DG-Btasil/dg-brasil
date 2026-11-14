import { z } from "zod";
import { PRIORITIES, REVIEW_DECISIONS } from "@/lib/constants/status";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zIsoDateTime, zOptionalText, zUuid } from "@/server/core/validation";
import { BULK_DECISIONS, MAX_BULK_REVIEWS } from "./bulk-rules";
import { REDO_MESSAGE_MAX, REDO_MESSAGE_MIN } from "./redo-rules";

/**
 * Entrada das operações de revisão humana. Decisão no vocabulário do FRONT
 * (APPROVED, CHANGES_REQUESTED, REJECTED); o mapper traduz para o banco. O
 * status da revisão nunca é um campo de entrada: só muda por decide_review.
 */

export const REVIEW_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at", dueAt: "due_at" } as const;
export const REVIEW_TARGET_KINDS = ["DOCUMENT_VERSION", "ANALYSIS", "AGENT_PROPOSAL"] as const;
/** Status do banco + "OPEN" (PENDING ou REOPENED: aguardando decisão). */
export const REVIEW_STATUS_FILTERS = ["OPEN", "PENDING", "REOPENED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] as const;
/**
 * Prazo da revisão (`due_at`). "NEXT_7_DAYS" = vence até o fim do 7º dia (fuso
 * de São Paulo), inclusive as já vencidas. Só revisões em aberto têm prazo
 * correndo: com este filtro, as decididas ficam de fora.
 */
export const REVIEW_DUE_FILTERS = ["NEXT_7_DAYS"] as const;
export type ReviewDueFilter = (typeof REVIEW_DUE_FILTERS)[number];

/** Busca por texto: cliente, caso, título do item ou agente (o banco ignora acento e maiúscula). */
export const REVIEW_SEARCH_MAX = 120;

/** Filtros comuns à fila plana e à fila agrupada. */
const reviewFilterShape = {
  status: z.enum(REVIEW_STATUS_FILTERS).optional(),
  /** Uma prioridade ou várias (o indicador "Urgentes e alta prioridade" manda URGENT + HIGH). */
  priority: z.union([z.enum(PRIORITIES), z.array(z.enum(PRIORITIES)).min(1).max(PRIORITIES.length)]).optional(),
  due: z.enum(REVIEW_DUE_FILTERS).optional(),
  /** "me" = atribuídas a mim; "unassigned" = sem responsável; ou o id do revisor. */
  assignee: z.union([z.literal("me"), z.literal("unassigned"), zUuid()]).optional(),
  legalCaseId: zUuid().optional(),
  processId: zUuid().optional(),
  targetKind: z.enum(REVIEW_TARGET_KINDS).optional(),
  search: z.string().trim().max(REVIEW_SEARCH_MAX).optional(),
};

export const listReviewsSchema = pageInputSchema
  .extend({
    ...reviewFilterShape,
    /** Itens de UM grupo da fila agrupada: os de uma execução do agente… */
    groupRunId: zUuid().optional(),
    /** …ou os que não vieram de execução (enviados por pessoas), de um caso. */
    groupCaseId: zUuid().optional(),
  })
  .refine((v) => !(v.groupRunId && v.groupCaseId), { message: "Escolha um grupo só.", path: ["groupRunId"] })
  .and(sortSchema(REVIEW_SORT_FIELDS, "createdAt"));
export type ListReviewsInput = z.infer<typeof listReviewsSchema>;

/** Fila agrupada por execução do agente (067). A ordem é a da fila: mais antigos ou mais recentes primeiro. */
export const listReviewGroupsSchema = pageInputSchema.extend({
  ...reviewFilterShape,
  sortDirection: z.enum(["asc", "desc"]).default("asc"),
});
export type ListReviewGroupsInput = z.infer<typeof listReviewGroupsSchema>;

export const reviewIdSchema = z.object({ id: zUuid() });

/** Texto editável cabe em 512 KB (UTF-8); acima disso, envie uma nova versão do arquivo. */
export const MANUAL_REVISION_MAX_CHARS = 400_000;

/** Edição manual (034): o servidor grava o texto como a versão N+1. Nada de id de versão vindo do navegador além da BASE. */
export const saveManualRevisionSchema = z.object({
  idempotencyKey: zUuid(),
  reviewId: zUuid(),
  baseVersionId: zUuid(),
  content: z
    .string()
    .max(MANUAL_REVISION_MAX_CHARS, "Texto longo demais para editar aqui: envie uma nova versão do arquivo.")
    .refine((v) => v.trim().length > 0, "O conteúdo não pode ficar em branco."),
});
export type SaveManualRevisionInput = z.infer<typeof saveManualRevisionSchema>;

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

/**
 * Decisão em conjunto: só aprovar ou rejeitar, até 50 itens por vez. A
 * justificativa da rejeição vale para todos. Cada item é decidido um a um.
 */
export const decideReviewsBulkSchema = z
  .object({
    ids: z.array(zUuid()).min(1, "Marque pelo menos um item.").max(MAX_BULK_REVIEWS, `No máximo ${MAX_BULK_REVIEWS} itens por vez.`),
    decision: z.enum(BULK_DECISIONS),
    notes: zOptionalText(5000),
  })
  .refine((v) => v.decision === "APPROVED" || !!v.notes, { message: "Informe a justificativa.", path: ["notes"] });
export type DecideReviewsBulkInput = z.infer<typeof decideReviewsBulkSchema>;

/**
 * "Corrigir e aprovar" (069). `data` são os dados corrigidos da proposta no
 * formato do contrato do agente (`PROPOSAL_DATA`); o service confere pelo
 * tipo da proposta, que vem do banco, e o banco confere de novo.
 */
export const correctReviewSchema = z.object({
  id: zUuid(),
  data: z.record(z.string(), z.unknown()),
  notes: zOptionalText(5000),
});
export type CorrectReviewInput = z.infer<typeof correctReviewSchema>;

/** "Pedir para o agente refazer" (070): a revisão é encerrada e o mesmo agente recebe o recado. */
export const redoReviewSchema = z.object({
  id: zUuid(),
  message: z
    .string()
    .trim()
    .min(REDO_MESSAGE_MIN, `Escreva o que precisa mudar (no mínimo ${REDO_MESSAGE_MIN} caracteres).`)
    .max(REDO_MESSAGE_MAX, `Máximo de ${REDO_MESSAGE_MAX} caracteres.`),
});
export type RedoReviewInput = z.infer<typeof redoReviewSchema>;

export const reopenReviewSchema = z.object({
  id: zUuid(),
  reason: zOptionalText(5000),
});
export type ReopenReviewInput = z.infer<typeof reopenReviewSchema>;
