import { hasRole, requireInternal, requirePermission, requireRole, type ServiceContext } from "@/server/core/context";
import { forbidden, invalidState, notFound } from "@/server/core/errors";
import type { AgentRunRequestDTO, AgentRunSummaryDTO } from "./dto";
import { summaryFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListAgentRunSummariesInput, RequestAgentRunInput } from "./schemas";

/**
 * Execuções de agente — "IA executa. Humano decide." Este service só PEDE a
 * execução (request_agent_run_once → request_agent_run: valida papel e caso,
 * grava, enfileira e audita numa transação, com chave de idempotência) e lê
 * resumos (get_agent_run_summaries). Executar é do worker.
 *
 * Permissão: `analyses.start` (ADMIN e LAWYER). LAWYER só com caso; ASSISTANT
 * e parceiros, nunca — o banco revalida tudo contra o usuário do JWT.
 * Nunca logar o pedido em texto: só ids.
 */

/**
 * Pede a execução por request_agent_run_once (026). Duplo clique/nova
 * tentativa com a MESMA chave do formulário devolve a mesma execução
 * (`deduplicated`), inclusive em corrida — a unique do banco decide.
 */
export async function requestAgentRun(ctx: ServiceContext, input: RequestAgentRunInput): Promise<AgentRunRequestDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  if (!input.legalCaseId && !hasRole(ctx, "ADMIN")) throw forbidden("Execução sem caso é só de ADMIN.");

  const { runId, deduplicated } = await repo.requestRunOnce(ctx.db, {
    idempotencyKey: input.idempotencyKey,
    agentId: input.agentId,
    legalCaseId: input.legalCaseId ?? null,
    processId: input.processId ?? null,
    requestText: input.requestText ?? null,
    // Só o correlation ID (UUID, sem PII): liga a execução à requisição que a pediu.
    parameters: { request_id: ctx.requestId },
    operation: input.operation,
  });
  ctx.log.info(deduplicated ? "agent_run.deduplicated" : "agent_run.requested", { agentRunId: runId, agentId: input.agentId, legalCaseId: input.legalCaseId });
  return { runId, deduplicated };
}

/** Resumos SÓ pela RPC: ADMIN vê todas; LAWYER, as dos casos que acessa. */
export async function listAgentRunSummaries(ctx: ServiceContext, input: ListAgentRunSummariesInput): Promise<AgentRunSummaryDTO[]> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  return (await repo.summaries(ctx.db, input.legalCaseId ?? null, input.limit)).map(summaryFromRow);
}

/** ADMIN cancela uma execução ainda não encerrada. */
export async function cancelAgentRun(ctx: ServiceContext, id: string): Promise<void> {
  requireRole(ctx, "ADMIN");
  requirePermission(ctx, "dgbrasil.manage");
  const changed = await repo.cancel(ctx.db, id);
  if (changed === 0) {
    if (!(await repo.adminRunExists(ctx.db, id))) throw notFound("Execução não encontrada.");
    throw invalidState("A execução já foi encerrada.");
  }
  ctx.log.info("agent_run.cancelled", { agentRunId: id });
}
