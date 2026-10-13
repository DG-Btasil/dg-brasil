import { z } from "zod";
import { pageInputSchema, sortSchema } from "@/server/core/pagination";
import { zOptionalText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de análise jurídica. O cliente da análise é o do
 * CASO (lido no banco): `clientId` do navegador não é aceito.
 */

export const DB_ANALYSIS_STATUSES = ["PENDING", "WAITING_DOCUMENTS", "QUEUED", "RUNNING", "WAITING_REVIEW", "COMPLETED", "FAILED", "CANCELLED"] as const;

export const ANALYSIS_SORT_FIELDS = { createdAt: "created_at", updatedAt: "updated_at" } as const;

export const listAnalysesSchema = pageInputSchema
  .extend({
    legalCaseId: zUuid().optional(),
    status: z.enum(DB_ANALYSIS_STATUSES).optional(),
  })
  .and(sortSchema(ANALYSIS_SORT_FIELDS, "createdAt"));
export type ListAnalysesInput = z.infer<typeof listAnalysesSchema>;

export const analysisIdSchema = z.object({ id: zUuid() });

/** Chave de campo do template (mesmo formato do banco: analysis_template_fields.key). */
const fieldKey = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "Campo inválido.");

export const startAnalysisSchema = z.object({
  /** Chave de envio (UUID) — uma por intenção; retry reutiliza (027/029). */
  idempotencyKey: zUuid(),
  legalCaseId: zUuid(),
  templateId: zUuid(),
  /** Respostas aos campos do template; conferidas contra a definição do template no service. */
  fields: z
    .record(fieldKey, z.string().trim().max(5000, "Máximo de 5000 caracteres."))
    .refine((f) => Object.keys(f).length <= 100, "Campos demais.")
    .default({}),
  /** true = já envia ao agente do template na MESMA transação (029). */
  send: z.boolean().default(false),
  /** Pedido em texto ao agente (vai para agent_run_inputs; nunca para log). */
  requestText: zOptionalText(20_000),
});
export type StartAnalysisInput = z.infer<typeof startAnalysisSchema>;

/** Templates ativos da área do caso, com campos e o que falta de documento. */
export const analysisSetupSchema = z.object({ legalCaseId: zUuid() });

/** Envia a análise ao agente do template (pede a execução; não executa nada aqui). */
export const sendAnalysisToAgentSchema = z.object({
  analysisId: zUuid(),
  /** Chave de envio (UUID) por intenção: repetir devolve a mesma execução (029). */
  idempotencyKey: zUuid(),
  requestText: zOptionalText(20_000),
});
export type SendAnalysisToAgentInput = z.infer<typeof sendAnalysisToAgentSchema>;
