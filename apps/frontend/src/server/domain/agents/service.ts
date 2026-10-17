import { hasRole, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { forbidden } from "@/server/core/errors";
import { toPage, toRange, type Page } from "@/server/core/pagination";
import type { AgentRunCancelDTO, AgentRunDetailDTO, AgentRunRequestDTO, AgentRunRetryDTO, AgentRunSummaryDTO } from "./dto";
import { detailFromJson, summaryFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListAgentRunsInput, ListAgentRunSummariesInput, RequestAgentRunInput } from "./schemas";

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

/** Lista paginada (031). ADMIN: todas; LAWYER: as dos casos que acessa (o banco decide). */
export async function listAgentRuns(ctx: ServiceContext, input: ListAgentRunsInput): Promise<Page<AgentRunSummaryDTO>> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  const { from } = toRange(input);
  const { rows, total } = await repo.summariesPage(ctx.db, { legalCaseId: input.legalCaseId, status: input.status, agentId: input.agentId }, from, input.pageSize);
  const items = rows.map(summaryFromRow);
  return toPage(await withCancelState(ctx, items), total, input);
}

/** Marca as RUNNING com pedido de interrupção pendente (uma consulta para a página). */
export async function withCancelState(ctx: ServiceContext, items: AgentRunSummaryDTO[]): Promise<AgentRunSummaryDTO[]> {
  const running = items.filter((i) => i.status === "RUNNING").map((i) => i.id);
  if (running.length === 0) return items;
  const state = await repo.cancelState(ctx.db, running);
  return items.map((i) => (state.get(i.id) ? { ...i, cancelRequested: true } : i));
}

/**
 * Interromper uma execução (033). ADMIN: qualquer uma; LAWYER: de caso que
 * acessa (o banco decide e responde "não encontrada" sem revelar). QUEUED para
 * já; RUNNING vira pedido que o worker confirma. Repetir é idempotente.
 */
export async function cancelAgentRun(ctx: ServiceContext, id: string): Promise<AgentRunCancelDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  const r = await repo.requestCancel(ctx.db, id);
  ctx.log.info("agent_run.cancel_requested", { agentRunId: id, outcome: r.outcome });
  return { agentRunId: r.agent_run_id, status: r.status as AgentRunCancelDTO["status"], outcome: r.outcome as AgentRunCancelDTO["outcome"] };
}

/** Uma execução: o que entregou (com a revisão de cada item) e as tentativas ligadas (039). */
export async function getAgentRunDetail(ctx: ServiceContext, id: string): Promise<AgentRunDetailDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  return detailFromJson(await repo.detail(ctx.db, id));
}

/**
 * Nova tentativa de execução avulsa (falhou ou foi interrompida): OUTRA
 * execução com a mesma entrada, ligada à anterior. A de análise é reenviada
 * pela análise (o banco recusa aqui). Idempotente pela chave.
 */
export async function retryAgentRun(ctx: ServiceContext, key: string, id: string): Promise<AgentRunRetryDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
  const r = await repo.retry(ctx.db, key, id);
  ctx.log.info("agent_run.retry_requested", { agentRunId: r.agent_run_id, retryOf: id, deduplicated: r.deduplicated });
  return { runId: r.agent_run_id, retryOfId: r.retry_of_agent_run_id, deduplicated: r.deduplicated === true };
}
