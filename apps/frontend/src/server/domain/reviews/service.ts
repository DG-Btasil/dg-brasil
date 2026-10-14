import { hasRole, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, forbidden, invalidState, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { DbReviewStatus } from "@/repositories/api/db-mappings";
import type { ReviewDetailDTO, ReviewListItem, ReviewTargetDTO } from "./dto";
import {
  analysisTargetFromRow,
  assignPayload,
  decisionFromRow,
  decisionToDb,
  documentVersionTargetFromRow,
  listItemFromRow,
  proposalTargetFromRow,
  statusFilterToDb,
  targetOf,
  type ReviewRow,
} from "./mappers";
import * as repo from "./repository";
import type { AssignReviewInput, DecideReviewInput, ListReviewsInput, ReopenReviewInput } from "./schemas";

/**
 * Revisão humana — "IA executa. Humano decide." Só ADMIN e LAWYER
 * (`reviews.view`/`reviews.decide`; a RLS de reviews é a mesma). ASSISTANT e
 * parceiros não acessam. Decidir é SÓ pela RPC decide_review: este service
 * nunca grava status. Proposta estrutural (UPDATE_AGENT, UPDATE_SKILL…) só
 * ADMIN decide — o banco recusa; aqui é só a mensagem amigável.
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

export async function listReviews(ctx: ServiceContext, input: ListReviewsInput): Promise<Page<ReviewListItem>> {
  requireReviewer(ctx, "reviews.view");
  const assignee =
    input.assignee === "me"
      ? { kind: "user" as const, id: ctx.session.userId }
      : input.assignee === "unassigned"
        ? { kind: "unassigned" as const }
        : input.assignee
          ? { kind: "user" as const, id: input.assignee }
          : undefined;
  const { rows, total } = await repo.list(
    ctx.db,
    { statuses: statusFilterToDb(input.status), priority: input.priority, assignee, legalCaseId: input.legalCaseId, processId: input.processId, targetKind: input.targetKind },
    input,
    { column: input.column, ascending: input.ascending },
  );
  return toPage(rows.map(listItemFromRow), total, input);
}

async function loadTarget(ctx: ServiceContext, row: ReviewRow): Promise<ReviewTargetDTO | null> {
  const target = targetOf(row);
  if (target.kind === "ANALYSIS") {
    const t = await repo.getAnalysisTarget(ctx.db, target.id);
    return t ? analysisTargetFromRow(t) : null;
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
  const decisionId = await repo.decide(ctx.db, input.id, decisionToDb(input.decision), input.notes ?? null);
  const after = listItemFromRow(await loadReview(ctx, input.id));
  ctx.log.info("review.decided", { reviewId: input.id, reviewDecisionId: decisionId, decision: input.decision });
  return { decisionId, status: after.status };
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
