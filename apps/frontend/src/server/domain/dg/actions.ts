"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  historySchema, idSchema, prepareReferenceFileSchema, prepareSkillFilesSchema, saveAgentSchema, saveReferenceSchema,
  saveSkillSchema, saveThesisSchema, setAgentStatusSchema, setAiEnabledSchema, setTemplateAgentSchema, usageSchema,
} from "./schemas";

/**
 * Server Actions da área DG Brasil. Tudo exige `dgbrasil.manage` (ADMIN); o
 * banco revalida (RLS só ADMIN + checagem nas RPCs 039). Nenhuma executa IA.
 * Exceção: a situação do interruptor da IA, que qualquer usuário interno lê
 * (a tela de análise avisa quando a IA está desligada).
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

export async function listDgSkillsAction() {
  return runAction({ name: "dg.skills", permission: manage, schema: empty, input: {}, handler: (ctx) => service.listSkills(ctx) });
}
export async function getDgSkillAction(input: unknown) {
  return runAction({ name: "dg.skill", permission: manage, schema: idSchema, input, handler: (ctx, { id }) => service.getSkill(ctx, id) });
}
export async function prepareDgSkillFilesAction(input: unknown) {
  return runAction({ name: "dg.skill_prepare_files", permission: manage, schema: prepareSkillFilesSchema, input, handler: (ctx, v) => service.prepareSkillFiles(ctx, v) });
}
export async function saveDgSkillAction(input: unknown) {
  return runAction({ name: "dg.skill_save", permission: manage, schema: saveSkillSchema, input, handler: service.saveSkill });
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

/** Situação do interruptor da IA: qualquer usuário interno. */
export async function getAiStatusAction() {
  return runAction({ name: "ai.status", schema: empty, input: {}, handler: (ctx) => service.getAiStatus(ctx) });
}
export async function setAiEnabledAction(input: unknown) {
  return runAction({ name: "ai.set_enabled", permission: manage, schema: setAiEnabledSchema, input, handler: (ctx, v) => service.setAiEnabled(ctx, v.enabled, v.reason) });
}
export async function getAiUsageAction(input: unknown) {
  return runAction({ name: "ai.usage", permission: manage, schema: usageSchema, input, handler: (ctx, v) => service.getAiUsage(ctx, v.days) });
}
