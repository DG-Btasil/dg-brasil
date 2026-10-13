import { hasRole, requireInternal, requirePermission, requireRole, type ServiceContext } from "@/server/core/context";
import { forbidden, invalidState, notFound } from "@/server/core/errors";
import type { AgentRunRequestDTO, AgentRunSummaryDTO } from "./dto";
import { findRecentDuplicate, summaryFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListAgentRunSummariesInput, RequestAgentRunInput } from "./schemas";

/**
 * Execuções de agente — "IA executa. Humano decide." Este service só PEDE a
 * execução (request_agent_run: valida papel e caso, grava, enfileira e audita
 * numa transação) e lê resumos (get_agent_run_summaries). Executar é do worker.
 *
 * Permissão: `analyses.start` (ADMIN e LAWYER). LAWYER só com caso; ASSISTANT
 * e parceiros, nunca — o banco revalida tudo contra o usuário do JWT.
 * Nunca logar o pedido em texto: só ids.
 */

/** Quantas execuções recentes conferir no anti-duplo-clique. */
const DUPLICATE_LOOKBACK = 50;

export async function requestAgentRun(ctx: ServiceContext, input: RequestAgentRunInput): Promise<AgentRunRequestDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  if (!input.legalCaseId && !hasRole(ctx, "ADMIN")) throw forbidden("Execução sem caso é só de ADMIN.");

  const identity = {
    agentId: input.agentId,
    legalCaseId: input.legalCaseId ?? null,
    processId: input.processId ?? null,
    operation: input.operation,
    requestedBy: ctx.session.userId,
  };

  // Duplo clique: o mesmo pedido ainda na fila, feito há segundos, é devolvido em vez de duplicado.
  const recent = await repo.summaries(ctx.db, identity.legalCaseId, DUPLICATE_LOOKBACK);
  const duplicate = findRecentDuplicate(recent, identity, Date.now());
  if (duplicate) {
    ctx.log.info("agent_run.deduplicated", { agentRunId: duplicate.id, agentId: input.agentId, legalCaseId: input.legalCaseId });
    return { runId: duplicate.id, deduplicated: true };
  }

  const runId = await repo.requestRun(ctx.db, {
    agentId: input.agentId,
    legalCaseId: identity.legalCaseId,
    processId: identity.processId,
    requestText: input.requestText ?? null,
    // Só o correlation ID (UUID, sem PII): liga a execução à requisição que a pediu.
    parameters: { request_id: ctx.requestId },
    operation: input.operation,
  });
  ctx.log.info("agent_run.requested", { agentRunId: runId, agentId: input.agentId, legalCaseId: input.legalCaseId });
  return { runId, deduplicated: false };
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
