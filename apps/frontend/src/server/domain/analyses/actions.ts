"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { analysisIdSchema, listAnalysesSchema, sendAnalysisToAgentSchema, startAnalysisSchema } from "./schemas";

/**
 * Server Actions de análise jurídica. Todas exigem `analyses.start` (ADMIN e
 * LAWYER) — a mesma regra da RLS de legal_analyses. Nenhuma chama IA.
 */

export async function listAnalysesAction(input: unknown) {
  return runAction({ name: "analyses.list", permission: "analyses.start", schema: listAnalysesSchema, input, handler: service.listAnalyses });
}

export async function getAnalysisAction(input: unknown) {
  return runAction({ name: "analyses.get", permission: "analyses.start", schema: analysisIdSchema, input, handler: (ctx, { id }) => service.getAnalysis(ctx, id) });
}

export async function getMissingRequirementsAction(input: unknown) {
  return runAction({
    name: "analyses.missing_requirements",
    permission: "analyses.start",
    schema: analysisIdSchema,
    input,
    handler: (ctx, { id }) => service.getMissingRequirements(ctx, id),
  });
}

export async function startAnalysisAction(input: unknown) {
  return runAction({ name: "analyses.start", permission: "analyses.start", schema: startAnalysisSchema, input, handler: service.startAnalysis });
}

export async function sendAnalysisToAgentAction(input: unknown) {
  return runAction({ name: "analyses.send_to_agent", permission: "analyses.start", schema: sendAnalysisToAgentSchema, input, handler: service.sendAnalysisToAgent });
}
