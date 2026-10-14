"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  addPartySchema,
  createEventSchema,
  createPartnerProcessSchema,
  createProcessSchema,
  listCaseProcessesSchema,
  listEventsSchema,
  listPartiesSchema,
  listProcessesSchema,
  processIdSchema,
  updatePartySchema,
  updateProcessSchema,
} from "./schemas";

/**
 * Server Actions de Processo, Partes e Movimentações — a única porta do
 * navegador para este domínio. Cada uma: sessão + permissão (runAction) →
 * Zod → service. O input é `unknown` de propósito. Prazos: ./deadlines/actions.
 */

export async function listProcessesAction(input: unknown) {
  return runAction({ name: "processes.list", permission: "processes.view", schema: listProcessesSchema, input, handler: service.listProcesses });
}

/** Contadores da carteira (equipe interna). */
export async function getProcessSummaryAction(input?: unknown) {
  return runAction({ name: "processes.summary", permission: "processes.view", schema: z.unknown(), input, handler: (ctx) => service.getProcessSummary(ctx) });
}

export async function listCaseProcessesAction(input: unknown) {
  return runAction({ name: "processes.list_by_case", permission: "processes.view", schema: listCaseProcessesSchema, input, handler: service.listCaseProcesses });
}

export async function getProcessAction(input: unknown) {
  return runAction({ name: "processes.get", permission: "processes.view", schema: processIdSchema, input, handler: (ctx, { id }) => service.getProcess(ctx, id) });
}

export async function createProcessAction(input: unknown) {
  return runAction({ name: "processes.create", permission: "processes.edit", schema: createProcessSchema, input, handler: service.createProcess });
}

export async function createPartnerProcessAction(input: unknown) {
  return runAction({
    name: "processes.partner_create",
    permission: "partnerPortal.processes.create",
    schema: createPartnerProcessSchema,
    input,
    handler: service.createPartnerProcess,
  });
}

export async function updateProcessAction(input: unknown) {
  return runAction({ name: "processes.update", permission: "processes.edit", schema: updateProcessSchema, input, handler: service.updateProcess });
}

export async function removeProcessAction(input: unknown) {
  return runAction({ name: "processes.remove", permission: "processes.delete", schema: processIdSchema, input, handler: (ctx, { id }) => service.removeProcess(ctx, id) });
}

export async function listProcessPartiesAction(input: unknown) {
  return runAction({ name: "processes.parties.list", permission: "processes.view", schema: listPartiesSchema, input, handler: service.listParties });
}

/** Interno (processes.edit) ou parceiro (partnerPortal.processes.create): o service decide pela superfície. */
export async function addProcessPartyAction(input: unknown) {
  return runAction({ name: "processes.parties.add", schema: addPartySchema, input, handler: service.addParty });
}

export async function updateProcessPartyAction(input: unknown) {
  return runAction({ name: "processes.parties.update", permission: "processes.edit", schema: updatePartySchema, input, handler: service.updateParty });
}

export async function listProcessEventsAction(input: unknown) {
  return runAction({ name: "processes.events.list", permission: "processes.view", schema: listEventsSchema, input, handler: service.listEvents });
}

export async function createProcessEventAction(input: unknown) {
  return runAction({
    name: "processes.events.create",
    permission: "processes.edit",
    schema: createEventSchema,
    input,
    handler: (ctx, data) => service.createEvent(ctx, data),
  });
}
