import { randomUUID } from "node:crypto";
import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "./dto";
import { addDays, deadlineFromRows, deadlineInsertRow, deadlineUpdatePatch, mergePage, officeLocalDate } from "./mappers";
import * as repo from "./repository";
import type { CreateDeadlineInput, ListDeadlinesInput, ListOverdueInput, ListUpcomingInput, UpdateDeadlineInput } from "./schemas";

/**
 * Regras de Prazo. Só equipe interna (parceiro não tem política de leitura
 * em `deadlines`). Leitura: `processes.view` (ADMIN, LAWYER, ASSISTANT).
 * Escrita: `processes.edit` (ADMIN, LAWYER) — ASSISTANT só lê, como na RLS.
 *
 * Status gravado: OPEN → COMPLETED | CANCELLED | MISSED (só a partir de
 * OPEN). OVERDUE é derivado (view deadline_status) e nunca é gravado.
 */

function requireRead(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "processes.view");
}

function requireWrite(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
}

async function pageFromStatus(
  ctx: ServiceContext,
  filters: repo.StatusFilters,
  input: { page: number; pageSize: number },
  ascending = true,
): Promise<Page<DeadlineDTO>> {
  const { rows: statusRows, total } = await repo.listStatusPage(ctx.db, filters, input, ascending);
  const rows = await repo.getByIds(
    ctx.db,
    statusRows.map((s) => s.deadline_id),
  );
  return toPage(mergePage(statusRows, rows, ascending), total, input);
}

/** Prazos de um caso/processo (ou do escritório), por vencimento. */
export async function listDeadlines(ctx: ServiceContext, input: ListDeadlinesInput): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  return pageFromStatus(ctx, { effectiveStatus: input.effectiveStatus, caseId: input.caseId, processId: input.processId }, input);
}

/** Em aberto e no prazo, vencendo de hoje até hoje + `days` (data local de São Paulo). */
export async function listUpcomingDeadlines(ctx: ServiceContext, input: ListUpcomingInput, now = new Date()): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  const today = officeLocalDate(now);
  return pageFromStatus(
    ctx,
    { effectiveStatus: "OPEN", caseId: input.caseId, processId: input.processId, fromLocalDate: today, untilLocalDate: addDays(today, input.days) },
    input,
  );
}

/** Vencidos (OPEN com vencimento no passado — derivado pela view), mais antigos primeiro. */
export async function listOverdueDeadlines(ctx: ServiceContext, input: ListOverdueInput): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  return pageFromStatus(ctx, { effectiveStatus: "OVERDUE", caseId: input.caseId, processId: input.processId }, input);
}

export async function getDeadline(ctx: ServiceContext, id: string): Promise<DeadlineDTO> {
  requireRead(ctx);
  const found = await repo.getOne(ctx.db, id);
  if (!found) throw notFound("Prazo não encontrado.");
  return deadlineFromRows(found.row, found.status);
}

/** Cadastro manual. Caso obrigatório; processo opcional e do MESMO caso. */
export async function createDeadline(ctx: ServiceContext, input: CreateDeadlineInput): Promise<{ id: string }> {
  requireWrite(ctx);
  if (!(await repo.caseVisible(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");
  if (input.processId && !(await repo.processBelongsToCase(ctx.db, input.processId, input.legalCaseId))) {
    throw validation({ processId: ["O processo não pertence a este caso."] }, "O processo não pertence a este caso.");
  }
  const id = randomUUID();
  await repo.insert(ctx.db, deadlineInsertRow(id, input, ctx.session.userId));
  ctx.log.info("deadline.created", { deadlineId: id, legalCaseId: input.legalCaseId, processId: input.processId });
  return { id };
}

/** Decide se a transição a partir do status atual é permitida (só de OPEN). */
async function requireOpen(ctx: ServiceContext, id: string): Promise<void> {
  const status = await repo.getStoredStatus(ctx.db, id);
  if (status === null) throw notFound("Prazo não encontrado.");
  if (status !== "OPEN") throw invalidState("Só é possível alterar um prazo em aberto.");
}

async function transition(ctx: ServiceContext, id: string, patch: Record<string, unknown>, event: string): Promise<void> {
  requireWrite(ctx);
  await requireOpen(ctx, id);
  // Guarda de corrida: só altera se continua OPEN.
  if (!(await repo.updateIfStatus(ctx.db, id, "OPEN", patch))) throw invalidState("O prazo foi alterado por outra pessoa. Atualize a página.");
  ctx.log.info(event, { deadlineId: id });
}

export async function updateDeadline(ctx: ServiceContext, input: UpdateDeadlineInput): Promise<void> {
  await transition(ctx, input.id, deadlineUpdatePatch(input.patch), "deadline.updated");
}

/** Cumprido. `completed_at` = agora (o trigger também garante). */
export async function completeDeadline(ctx: ServiceContext, id: string, now = new Date()): Promise<void> {
  await transition(ctx, id, { status: "COMPLETED", completed_at: now.toISOString() }, "deadline.completed");
}

export async function cancelDeadline(ctx: ServiceContext, id: string): Promise<void> {
  await transition(ctx, id, { status: "CANCELLED" }, "deadline.cancelled");
}

/** Perda do prazo constatada por humano (MISSED). Diferente de "vencido", que é derivado. */
export async function markDeadlineMissed(ctx: ServiceContext, id: string): Promise<void> {
  await transition(ctx, id, { status: "MISSED" }, "deadline.missed");
}
