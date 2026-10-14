"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { agentRunIdSchema, listAgentRunsSchema, listAgentRunSummariesSchema, requestAgentRunSchema } from "./schemas";

/**
 * Server Actions de execução de agente. Pedir e acompanhar: ADMIN e LAWYER
 * (`analyses.start`); cancelar: ADMIN (`dgbrasil.manage`). Nenhuma executa agente.
 */

export async function requestAgentRunAction(input: unknown) {
  return runAction({ name: "agents.request_run", permission: "analyses.start", schema: requestAgentRunSchema, input, handler: service.requestAgentRun });
}

export async function listAgentRunSummariesAction(input: unknown) {
  return runAction({ name: "agents.run_summaries", permission: "analyses.start", schema: listAgentRunSummariesSchema, input, handler: service.listAgentRunSummaries });
}

/** Lista paginada e filtrável (031). */
export async function listAgentRunsAction(input: unknown) {
  return runAction({ name: "agents.runs", permission: "analyses.start", schema: listAgentRunsSchema, input, handler: service.listAgentRuns });
}

export async function cancelAgentRunAction(input: unknown) {
  return runAction({ name: "agents.cancel_run", permission: "dgbrasil.manage", schema: agentRunIdSchema, input, handler: (ctx, { id }) => service.cancelAgentRun(ctx, id) });
}
