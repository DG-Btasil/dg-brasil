import { hasRole, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, DomainError, forbidden, invalidState, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { DbReviewStatus } from "@/repositories/api/db-mappings";
import { planBulkDecision, PROPOSAL_CHANGES_MESSAGE } from "./bulk-rules";
import type { BulkDecisionItemDTO, BulkDecisionResultDTO, ReviewDetailDTO, ReviewGroupPage, ReviewListItem, ReviewSummaryDTO, ReviewTargetDTO } from "./dto";
import {
  analysisTargetFromRow,
  assignPayload,
  decisionFromRow,
  decisionToDb,
  documentVersionTargetFromRow,
  dueStatuses,
  groupFromRow,
  listItemFromRow,
  priorityFilterToDb,
  proposalTargetFromRow,
  reviewDueCutoff,
  statusFilterToDb,
  targetOf,
  TOP_REVIEW_PRIORITIES,
  type ReviewRow,
} from "./mappers";
import * as repo from "./repository";
import type { AssignReviewInput, DecideReviewInput, DecideReviewsBulkInput, ListReviewGroupsInput, ListReviewsInput, ReopenReviewInput } from "./schemas";

/**
 * Revisão humana — "IA executa. Humano decide." Só ADMIN e LAWYER
 * (`reviews.view`/`reviews.decide`; a RLS de reviews é a mesma). ASSISTANT e
 * parceiros não acessam. Decidir é SÓ pela RPC decide_review: este service
 * nunca grava status. Proposta estrutural (UPDATE_AGENT, UPDATE_SKILL…) só
 * ADMIN decide — o banco recusa; aqui é só a mensagem amigável.
 * Proposta do agente só se aprova ou rejeita (067): "solicitar alterações"
 * vale para documento e análise. A decisão em conjunto é um laço sobre a
 * mesma RPC, item a item (regras em bulk-rules.ts).
 * Nunca logar conteúdo revisado nem justificativa: só ids.
 */

const NOT_FOUND_MESSAGE = "Revisão não encontrada.";
const OPEN: DbReviewStatus[] = ["PENDING", "REOPENED"];

function requireReviewer(ctx: ServiceContext, permission: "reviews.view" | "reviews.decide") {
  requireInternal(ctx);
  requirePermission(ctx, permission);
}

async function loadReview(ctx: ServiceContext, id: string): Promise<ReviewRow> {
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  return row;
}

/** Filtros da tela → filtros do repositório (os mesmos para a fila plana e a agrupada). */
function queueFilters(ctx: ServiceContext, input: ListReviewGroupsInput | ListReviewsInput): repo.ReviewFilters {
  const assignee =
    input.assignee === "me"
      ? { kind: "user" as const, id: ctx.session.userId }
      : input.assignee === "unassigned"
        ? { kind: "unassigned" as const }
        : input.assignee
          ? { kind: "user" as const, id: input.assignee }
          : undefined;
  const statuses = statusFilterToDb(input.status);
  return {
    // Prazo só corre em revisão aberta: com o filtro de prazo, as decididas saem.
    statuses: input.due ? dueStatuses(statuses) : statuses,
    priorities: priorityFilterToDb(input.priority),
    assignee,
    legalCaseId: input.legalCaseId,
    processId: input.processId,
    targetKind: input.targetKind,
    dueBefore: input.due ? reviewDueCutoff(input.due) : undefined,
    search: input.search || undefined,
  };
}

export async function listReviews(ctx: ServiceContext, input: ListReviewsInput): Promise<Page<ReviewListItem>> {
  requireReviewer(ctx, "reviews.view");
  const group = input.groupRunId ? { kind: "run" as const, id: input.groupRunId } : input.groupCaseId ? { kind: "case" as const, id: input.groupCaseId } : undefined;
  const { rows, total } = await repo.list(ctx.db, { ...queueFilters(ctx, input), group }, input, { column: input.column, ascending: input.ascending });
  return toPage(rows.map(listItemFromRow), total, input);
}

/**
 * A fila agrupada por execução do agente (067): cada grupo traz o agente, o
 * caso, o cliente, quando chegou, quantos itens tem por tipo e a prioridade
 * mais alta. O que foi enviado por pessoas forma um grupo por caso. Filtros e
 * página no banco, como a fila plana.
 */
export async function listReviewGroups(ctx: ServiceContext, input: ListReviewGroupsInput): Promise<ReviewGroupPage> {
  requireReviewer(ctx, "reviews.view");
  const { rows, total, totalItems } = await repo.listGroups(ctx.db, queueFilters(ctx, input), input, input.sortDirection === "asc");
  return { ...toPage(rows.map(groupFromRow), total, input), totalItems };
}

/**
 * Indicadores da fila (E-05): quatro contagens de revisões EM ABERTO, no banco
 * (head, sem linhas), em paralelo e com a RLS de quem pede.
 */
export async function getReviewSummary(ctx: ServiceContext, now = new Date()): Promise<ReviewSummaryDTO> {
  requireReviewer(ctx, "reviews.view");
  const [open, topPriority, dueSoon, unassigned] = await Promise.all([
    repo.count(ctx.db, { statuses: OPEN }),
    repo.count(ctx.db, { statuses: OPEN, priorities: [...TOP_REVIEW_PRIORITIES] }),
    repo.count(ctx.db, { statuses: OPEN, dueBefore: reviewDueCutoff("NEXT_7_DAYS", now) }),
    repo.count(ctx.db, { statuses: OPEN, assignee: { kind: "unassigned" } }),
  ]);
  return { open, topPriority, dueSoon, unassigned };
}

async function loadTarget(ctx: ServiceContext, row: ReviewRow): Promise<ReviewTargetDTO | null> {
  const target = targetOf(row);
  if (target.kind === "ANALYSIS") {
    const [t, exact] = await Promise.all([
      repo.getAnalysisTarget(ctx.db, target.id),
      row.legal_analysis_result_id ? repo.getAnalysisResult(ctx.db, row.legal_analysis_result_id) : Promise.resolve(null),
    ]);
    if (!t) return null;
    // Revisão de um resultado específico: mostra ESSE resultado (o atual pode ser de outra tentativa).
    return analysisTargetFromRow(exact ? { ...t, agent_run_id: exact.agent_run_id, summary: exact.summary, result_data: exact.result } : t);
  }
  if (target.kind === "DOCUMENT_VERSION") {
    const t = await repo.getDocumentVersionTarget(ctx.db, target.id);
    return t ? documentVersionTargetFromRow(t) : null;
  }
  const t = await repo.getProposalTarget(ctx.db, target.id);
  return t ? proposalTargetFromRow(t) : null;
}

/** Revisão com o conteúdo do ALVO (lido na hora) e o histórico de decisões. */
export async function getReview(ctx: ServiceContext, id: string): Promise<ReviewDetailDTO> {
  requireReviewer(ctx, "reviews.view");
  const row = await loadReview(ctx, id);
  const [target, decisions] = await Promise.all([loadTarget(ctx, row), repo.listDecisions(ctx.db, id)]);
  return { ...listItemFromRow(row), target, decisions: decisions.map(decisionFromRow) };
}

/** Responsável, prioridade e prazo (grant de coluna). Só revisão em aberto. */
export async function assignReview(ctx: ServiceContext, input: AssignReviewInput): Promise<void> {
  requireReviewer(ctx, "reviews.decide");
  const item = listItemFromRow(await loadReview(ctx, input.id));
  if (!OPEN.includes(item.dbStatus)) throw invalidState("Revisão já decidida não muda de responsável.");
  if (input.assignedReviewerId) {
    const role = await repo.internalRole(ctx.db, input.assignedReviewerId);
    if (role !== "ADMIN" && role !== "LAWYER") throw businessRule("O responsável precisa ser ADMIN ou advogado ativo do escritório.");
    if (item.requiresAdmin && role !== "ADMIN") throw businessRule("Proposta que altera a configuração do DG Brasil só pode ser atribuída a ADMIN.");
  }
  const changed = await repo.assign(ctx.db, input.id, assignPayload(input), OPEN);
  if (changed === 0) throw invalidState("A revisão mudou enquanto você editava. Atualize a página.");
  ctx.log.info("review.assigned", { reviewId: input.id, assignedReviewerId: input.assignedReviewerId ?? undefined });
}

/** Decide (aprovar, pedir alterações, rejeitar) — SÓ pela RPC decide_review. */
export async function decideReview(ctx: ServiceContext, input: DecideReviewInput): Promise<{ decisionId: string; status: ReviewListItem["status"] }> {
  requireReviewer(ctx, "reviews.decide");
  const item = listItemFromRow(await loadReview(ctx, input.id));
  if (item.requiresAdmin && !hasRole(ctx, "ADMIN")) throw forbidden("Somente ADMIN decide proposta que altera a configuração do DG Brasil.");
  if (!OPEN.includes(item.dbStatus)) throw invalidState("Esta revisão já foi decidida.");
  // Proposta não tem o que "alterar": o banco recusa (067); aqui é só a mensagem amigável.
  if (item.targetKind === "AGENT_PROPOSAL" && input.decision === "CHANGES_REQUESTED") throw invalidState(PROPOSAL_CHANGES_MESSAGE);
  const decisionId = await repo.decide(ctx.db, input.id, decisionToDb(input.decision), input.notes ?? null);
  const after = listItemFromRow(await loadReview(ctx, input.id));
  ctx.log.info("review.decided", { reviewId: input.id, reviewDecisionId: decisionId, decision: input.decision });
  return { decisionId, status: after.status };
}

/**
 * Decisão em conjunto (067). É só um laço: cada item é decidido UM A UM pela
 * mesma RPC decide_review, na sessão de quem clicou, com a decisão e a
 * auditoria de cada um. O que não pode entrar (documento, análise, proposta
 * que precisa ser aberta, proposta só de ADMIN, item já decidido) fica de
 * fora com o motivo. A falha de um item não desfaz os outros: o resultado
 * volta item a item, na ordem pedida.
 */
export async function decideReviewsBulk(ctx: ServiceContext, input: DecideReviewsBulkInput): Promise<BulkDecisionResultDTO> {
  requireReviewer(ctx, "reviews.decide");
  const ids = [...new Set(input.ids)];
  const rows = await repo.listByIds(ctx.db, ids);
  const plan = planBulkDecision(ids, rows.map(listItemFromRow), input.decision, hasRole(ctx, "ADMIN"));
  const items: BulkDecisionItemDTO[] = [];
  for (const step of plan) {
    if (step.outcome !== "DECIDE") {
      items.push(step.item);
      continue;
    }
    try {
      const decisionId = await repo.decide(ctx.db, step.item.id, decisionToDb(input.decision), input.notes ?? null);
      ctx.log.info("review.decided", { reviewId: step.item.id, reviewDecisionId: decisionId, decision: input.decision, bulk: true });
      items.push({ ...step.item, outcome: "DECIDED" });
    } catch (error) {
      // Mensagem segura (DomainError); o erro bruto do banco nunca sai daqui.
      const safe = error instanceof DomainError ? error : new DomainError("INTERNAL");
      ctx.log.warn("review.bulk_item_failed", { reviewId: step.item.id, code: safe.code, technicalCode: safe.technicalCode });
      items.push({ ...step.item, outcome: "FAILED", message: safe.publicMessage });
    }
  }
  const count = (outcome: BulkDecisionItemDTO["outcome"]) => items.filter((i) => i.outcome === outcome).length;
  return { decision: input.decision, decided: count("DECIDED"), skipped: count("SKIPPED"), failed: count("FAILED"), items };
}

/** Reabre revisão decidida (decisão REOPEN). Proposta de agente não se reabre: o agente gera outra. */
export async function reopenReview(ctx: ServiceContext, input: ReopenReviewInput): Promise<{ decisionId: string }> {
  requireReviewer(ctx, "reviews.decide");
  const item = listItemFromRow(await loadReview(ctx, input.id));
  if (item.targetKind === "AGENT_PROPOSAL") throw invalidState("Revisão de proposta de agente não se reabre: o agente gera uma nova proposta.");
  if (OPEN.includes(item.dbStatus)) throw invalidState("Esta revisão já está aberta.");
  const decisionId = await repo.decide(ctx.db, input.id, "REOPEN", input.reason ?? null);
  ctx.log.info("review.reopened", { reviewId: input.id, reviewDecisionId: decisionId });
  return { decisionId };
}
