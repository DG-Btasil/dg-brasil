"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  cancelProcessTaskSchema,
  completeProcessTaskSchema,
  createProcessTaskSchema,
  listProcessTasksSchema,
  saveTaskSettingsSchema,
  sendProcessTaskSchema,
} from "./schemas";

/** Tarefas do processo para os agentes (Roadmap 2.0, 047) — a porta do navegador para este domínio. */

export async function listProcessTasksAction(input: unknown) {
  return runAction({ name: "process_tasks.list", permission: "processes.view", schema: listProcessTasksSchema, input, handler: service.listProcessTasks });
}

export async function createProcessTaskAction(input: unknown) {
  return runAction({ name: "process_tasks.create", permission: "analyses.start", schema: createProcessTaskSchema, input, handler: service.createProcessTask });
}

export async function sendProcessTaskAction(input: unknown) {
  return runAction({ name: "process_tasks.send", permission: "analyses.start", schema: sendProcessTaskSchema, input, handler: service.sendProcessTask });
}

export async function completeProcessTaskAction(input: unknown) {
  return runAction({ name: "process_tasks.complete", permission: "analyses.start", schema: completeProcessTaskSchema, input, handler: service.completeProcessTask });
}

export async function cancelProcessTaskAction(input: unknown) {
  return runAction({ name: "process_tasks.cancel", permission: "analyses.start", schema: cancelProcessTaskSchema, input, handler: service.cancelProcessTask });
}

export async function listTaskAgentsAction() {
  return runAction({ name: "process_tasks.agents", permission: "analyses.start", schema: z.object({}).optional(), input: undefined, handler: (ctx) => service.listTaskAgents(ctx) });
}

export async function saveTaskSettingsAction(input: unknown) {
  return runAction({ name: "process_tasks.settings", permission: "dgbrasil.manage", schema: saveTaskSettingsSchema, input, handler: service.saveTaskSettings });
}
