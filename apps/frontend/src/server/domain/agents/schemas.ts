import { z } from "zod";
import { zOptionalText, zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de execução de agente. Nada de parâmetro livre vindo
 * do navegador: o pedido em texto vai para agent_run_inputs (retenção de 180
 * dias, leitura só de ADMIN e do solicitante) e os parâmetros são montados
 * no servidor (só o correlation ID).
 */

export const AGENT_RUN_STATUSES = ["QUEUED", "RUNNING", "WAITING_HUMAN", "COMPLETED", "FAILED", "CANCELLED"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const requestAgentRunSchema = z
  .object({
    agentId: zUuid(),
    /** Obrigatório para LAWYER (o service e o banco recusam sem caso). */
    legalCaseId: zUuid().optional(),
    processId: zUuid().optional(),
    requestText: zOptionalText(20_000),
    operation: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z_]{1,31}$/, "Operação inválida.")
      .default("EXECUTE"),
  })
  .refine((v) => !v.processId || v.legalCaseId, { message: "Processo informado sem caso.", path: ["processId"] });
export type RequestAgentRunInput = z.infer<typeof requestAgentRunSchema>;

/** A RPC devolve as N mais recentes (sem deslocamento): limite pequeno, sem paginação por página. */
export const listAgentRunSummariesSchema = z.object({
  legalCaseId: zUuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});
export type ListAgentRunSummariesInput = z.infer<typeof listAgentRunSummariesSchema>;

export const agentRunIdSchema = z.object({ id: zUuid() });
