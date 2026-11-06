import { z } from "zod";
import { zIsoDateTime, zOptionalText, zText, zUuid } from "@/server/core/validation";

/**
 * Tarefas do processo para os agentes (Roadmap 2.0, migration 047). A
 * situação da tarefa é do banco (acompanha a execução); daqui só saem os
 * pedidos da equipe: criar, enviar de novo, concluir (o "check") e cancelar.
 */

export const PROCESS_TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const listProcessTasksSchema = z.object({ processId: zUuid() });

export const createProcessTaskSchema = z.object({
  processId: zUuid(),
  title: zText(200, "Informe o título da tarefa."),
  instructions: zText(10_000, "Diga o que o agente precisa fazer."),
  /** Vazio = o orquestrador escolhe quem faz. */
  agentId: zUuid().optional(),
  dueAt: zIsoDateTime().optional(),
  priority: z.enum(PROCESS_TASK_PRIORITIES).default("NORMAL"),
  /** false = só registra (fica aberta); true = já vai para a fila. */
  send: z.boolean().default(true),
});
export type CreateProcessTaskInput = z.infer<typeof createProcessTaskSchema>;

export const sendProcessTaskSchema = z.object({ taskId: zUuid(), note: zOptionalText(2000) });
export const completeProcessTaskSchema = z.object({ taskId: zUuid(), note: zOptionalText(2000) });
export const cancelProcessTaskSchema = z.object({ taskId: zUuid(), reason: zText(1000, "Informe o motivo do cancelamento.") });
export const saveTaskSettingsSchema = z.object({ orchestratorAgentId: zUuid().nullable() });
