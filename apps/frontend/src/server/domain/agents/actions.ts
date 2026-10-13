"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { agentRunIdSchema, listAgentRunSummariesSchema, requestAgentRunSchema } from "./schemas";

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

export async function cancelAgentRunAction(input: unknown) {
  return runAction({ name: "agents.cancel_run", permission: "dgbrasil.manage", schema: agentRunIdSchema, input, handler: (ctx, { id }) => service.cancelAgentRun(ctx, id) });
}
