import "server-only";

import type { ServiceContext } from "@/server/core/context";
import { requireInternal, requirePermission } from "@/server/core/context";
import type { ProcessTaskDTO, TaskAgentDTO } from "./dto";
import { agentFromRow, sortTasks, taskFromRow } from "./mappers";
import * as repo from "./repository";
import type { CreateProcessTaskInput } from "./schemas";

/**
 * Tarefas do processo (047). Ler: equipe interna. Criar, reenviar, concluir e
 * cancelar: quem inicia trabalho de agente (ADMIN/LAWYER — o banco confere de
 * novo). Escolher o orquestrador: ADMIN.
 */

export async function listProcessTasks(ctx: ServiceContext, input: { processId: string }): Promise<ProcessTaskDTO[]> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.view");
  return sortTasks((await repo.listByProcess(ctx.db, input.processId)).map(taskFromRow));
}

export async function createProcessTask(ctx: ServiceContext, input: CreateProcessTaskInput): Promise<{ taskId: string; agentRunId?: string; status: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  const r = await repo.create(ctx.db, {
    processId: input.processId,
    title: input.title,
    instructions: input.instructions,
    agentId: input.agentId ?? null,
    dueAt: input.dueAt ?? null,
    priority: input.priority,
    send: input.send,
  });
  ctx.log.info("process_task.created", { taskId: r.task_id, queued: !!r.agent_run_id });
  return { taskId: r.task_id, agentRunId: r.agent_run_id ?? undefined, status: r.status };
}

export async function sendProcessTask(ctx: ServiceContext, input: { taskId: string; note?: string }): Promise<{ status: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  const r = await repo.send(ctx.db, input.taskId, input.note ?? null);
  ctx.log.info("process_task.sent", { taskId: input.taskId, queued: !!r.agent_run_id });
  return { status: r.status };
}

export async function completeProcessTask(ctx: ServiceContext, input: { taskId: string; note?: string }): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  await repo.complete(ctx.db, input.taskId, input.note ?? null);
  ctx.log.info("process_task.completed", { taskId: input.taskId });
}

export async function cancelProcessTask(ctx: ServiceContext, input: { taskId: string; reason: string }): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  await repo.cancel(ctx.db, input.taskId, input.reason);
  ctx.log.info("process_task.cancelled", { taskId: input.taskId });
}

export async function listTaskAgents(ctx: ServiceContext): Promise<TaskAgentDTO[]> {
  requireInternal(ctx);
  return (await repo.listAgents(ctx.db)).map(agentFromRow);
}

export async function saveTaskSettings(ctx: ServiceContext, input: { orchestratorAgentId: string | null }): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "dgbrasil.manage");
  await repo.saveSettings(ctx.db, input.orchestratorAgentId);
  ctx.log.info("process_task.settings_saved", {});
}
