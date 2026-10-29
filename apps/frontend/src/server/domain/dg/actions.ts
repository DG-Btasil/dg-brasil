"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  createExecutorSchema, historySchema, idSchema, prepareReferenceFileSchema, revokeExecutorSchema, saveAgentSchema,
  saveReferenceSchema, saveThesisSchema, setAgentStatusSchema, setAiEnabledSchema, setTemplateAgentSchema,
} from "./schemas";

/**
 * Server Actions da área DG Brasil. Tudo exige `dgbrasil.manage` (ADMIN); o
 * banco revalida (RLS só ADMIN + checagem nas RPCs 039/040). Nenhuma executa
 * IA: quem executa é o Claude Code do escritório. Exceção: a situação do
 * escritório (interruptor, computador conectado, fila), que qualquer usuário
 * interno lê (a tela de análise avisa quando ninguém está processando).
 */

const empty = z.object({}).default({});
const manage = "dgbrasil.manage" as const;

export async function getDgOverviewAction() {
  return runAction({ name: "dg.overview", permission: manage, schema: empty, input: {}, handler: (ctx) => service.overview(ctx) });
}
export async function getDgCatalogAction() {
  return runAction({ name: "dg.catalog", permission: manage, schema: empty, input: {}, handler: (ctx) => service.catalog(ctx) });
}

export async function listDgAgentsAction() {
  return runAction({ name: "dg.agents", permission: manage, schema: empty, input: {}, handler: (ctx) => service.listAgents(ctx) });
}
export async function getDgAgentAction(input: unknown) {
  return runAction({ name: "dg.agent", permission: manage, schema: idSchema, input, handler: (ctx, { id }) => service.getAgent(ctx, id) });
}
export async function saveDgAgentAction(input: unknown) {
  return runAction({ name: "dg.agent_save", permission: manage, schema: saveAgentSchema, input, handler: service.saveAgent });
}
export async function setDgAgentStatusAction(input: unknown) {
  return runAction({ name: "dg.agent_status", permission: manage, schema: setAgentStatusSchema, input, handler: (ctx, v) => service.setAgentStatus(ctx, v.id, v.status) });
}
export async function setDgTemplateAgentAction(input: unknown) {
  return runAction({ name: "dg.template_agent", permission: manage, schema: setTemplateAgentSchema, input, handler: (ctx, v) => service.setTemplateAgent(ctx, v.templateId, v.agentId) });
}

export async function listDgThesesAction() {
  return runAction({ name: "dg.theses", permission: manage, schema: empty, input: {}, handler: (ctx) => service.listTheses(ctx) });
}
export async function getDgThesisAction(input: unknown) {
  return runAction({ name: "dg.thesis", permission: manage, schema: idSchema, input, handler: (ctx, { id }) => service.getThesis(ctx, id) });
}
export async function saveDgThesisAction(input: unknown) {
  return runAction({ name: "dg.thesis_save", permission: manage, schema: saveThesisSchema, input, handler: service.saveThesis });
}

export async function listDgReferencesAction() {
  return runAction({ name: "dg.references", permission: manage, schema: empty, input: {}, handler: (ctx) => service.listReferences(ctx) });
}
export async function prepareDgReferenceFileAction(input: unknown) {
  return runAction({ name: "dg.reference_prepare_file", permission: manage, schema: prepareReferenceFileSchema, input, handler: (ctx, v) => service.prepareReferenceFile(ctx, v) });
}
export async function saveDgReferenceAction(input: unknown) {
  return runAction({ name: "dg.reference_save", permission: manage, schema: saveReferenceSchema, input, handler: service.saveReference });
}

export async function getDgHistoryAction(input: unknown) {
  return runAction({ name: "dg.history", permission: manage, schema: historySchema, input, handler: service.history });
}

/** Situação do interruptor e do escritório: qualquer usuário interno. */
export async function getAiStatusAction() {
  return runAction({ name: "ai.status", schema: empty, input: {}, handler: (ctx) => service.getAiStatus(ctx) });
}
export async function getOfficeStatusAction() {
  return runAction({ name: "office.status", schema: empty, input: {}, handler: (ctx) => service.getOfficeStatus(ctx) });
}
export async function setAiEnabledAction(input: unknown) {
  return runAction({ name: "ai.set_enabled", permission: manage, schema: setAiEnabledSchema, input, handler: (ctx, v) => service.setAiEnabled(ctx, v.enabled, v.reason) });
}
export async function createExecutorAction(input: unknown) {
  return runAction({ name: "office.executor_create", permission: manage, schema: createExecutorSchema, input, handler: (ctx, v) => service.createExecutor(ctx, v.name) });
}
export async function revokeExecutorAction(input: unknown) {
  return runAction({ name: "office.executor_revoke", permission: manage, schema: revokeExecutorSchema, input, handler: (ctx, v) => service.revokeExecutor(ctx, v.id) });
}
