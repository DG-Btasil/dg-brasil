"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { createDeadlineSchema, deadlineIdSchema, listDeadlinesSchema, listOverdueSchema, listUpcomingSchema, updateDeadlineSchema } from "./schemas";

/**
 * Server Actions de Prazo — a única porta do navegador para este domínio.
 * Leitura: `processes.view` (equipe interna). Escrita: `processes.edit`
 * (ADMIN/LAWYER). O service confere de novo (superfície interna); a RLS é a
 * segunda barreira.
 */

export async function listDeadlinesAction(input: unknown) {
  return runAction({ name: "deadlines.list", permission: "processes.view", schema: listDeadlinesSchema, input, handler: service.listDeadlines });
}

export async function listUpcomingDeadlinesAction(input: unknown) {
  return runAction({
    name: "deadlines.upcoming",
    permission: "processes.view",
    schema: listUpcomingSchema,
    input,
    handler: (ctx, data) => service.listUpcomingDeadlines(ctx, data),
  });
}

export async function listOverdueDeadlinesAction(input: unknown) {
  return runAction({ name: "deadlines.overdue", permission: "processes.view", schema: listOverdueSchema, input, handler: service.listOverdueDeadlines });
}

export async function getDeadlineAction(input: unknown) {
  return runAction({ name: "deadlines.get", permission: "processes.view", schema: deadlineIdSchema, input, handler: (ctx, { id }) => service.getDeadline(ctx, id) });
}

export async function createDeadlineAction(input: unknown) {
  return runAction({ name: "deadlines.create", permission: "processes.edit", schema: createDeadlineSchema, input, handler: service.createDeadline });
}

export async function updateDeadlineAction(input: unknown) {
  return runAction({ name: "deadlines.update", permission: "processes.edit", schema: updateDeadlineSchema, input, handler: service.updateDeadline });
}

export async function completeDeadlineAction(input: unknown) {
  return runAction({
    name: "deadlines.complete",
    permission: "processes.edit",
    schema: deadlineIdSchema,
    input,
    handler: (ctx, { id }) => service.completeDeadline(ctx, id),
  });
}

export async function cancelDeadlineAction(input: unknown) {
  return runAction({ name: "deadlines.cancel", permission: "processes.edit", schema: deadlineIdSchema, input, handler: (ctx, { id }) => service.cancelDeadline(ctx, id) });
}

export async function markDeadlineMissedAction(input: unknown) {
  return runAction({ name: "deadlines.missed", permission: "processes.edit", schema: deadlineIdSchema, input, handler: (ctx, { id }) => service.markDeadlineMissed(ctx, id) });
}
