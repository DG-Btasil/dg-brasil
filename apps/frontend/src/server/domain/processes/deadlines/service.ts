import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import { collectForExport, exportCsv, mapChunks, type ExportFileDTO } from "@/server/domain/exports/service";
import { listProfileNames } from "../repository";
import type { DeadlineCreatedDTO, DeadlineDTO } from "./dto";
import { DEADLINE_EXPORT_COLUMNS, type DeadlineExportRow } from "./export";
import { addDays, deadlineCreatePayload, deadlineFromAgendaRow, deadlineUpdatePatch, officeLocalDate, resolveResponsible } from "./mappers";
import * as repo from "./repository";
import type {
  CancelDeadlineInput,
  CreateDeadlineInput,
  ListDeadlinesInput,
  ListOverdueInput,
  ListUpcomingInput,
  MissDeadlineInput,
  ReopenDeadlineInput,
  UpdateDeadlineInput,
} from "./schemas";

/**
 * Regras de Prazo. Só equipe interna (parceiro não tem política de leitura
 * em `deadlines`). Leitura: `processes.view` (ADMIN, LAWYER, ASSISTANT).
 * Escrita: `processes.edit` (ADMIN, LAWYER) — ASSISTANT só lê, como na RLS.
 *
 * Situação gravada: OPEN → COMPLETED | CANCELLED | MISSED, e de volta para
 * OPEN ao reabrir (com motivo). Quem garante a troca, o motivo e a auditoria é
 * o banco (deadline_transition, migration 063); aqui não se repete a regra.
 * OVERDUE é derivado e nunca é gravado.
 */

function requireRead(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "processes.view");
}

function requireWrite(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
}

/** Filtros comuns das listagens (só equipe interna chega aqui — requireRead). */
function scope(ctx: ServiceContext, input: { caseId?: string; processId?: string; responsibleUserId?: string }): repo.AgendaFilters {
  return { caseId: input.caseId, processId: input.processId, responsibleUserId: resolveResponsible(input.responsibleUserId, ctx.session.userId) };
}

async function agendaPage(ctx: ServiceContext, filters: repo.AgendaFilters, input: { page: number; pageSize: number }, ascending = true): Promise<Page<DeadlineDTO>> {
  const { rows, total } = await repo.listAgendaPage(ctx.db, filters, input, ascending);
  return toPage(rows.map(deadlineFromAgendaRow), total, input);
}

/** Filtros da agenda como o repositório espera (os mesmos na tela e na exportação). */
function agendaFilters(ctx: ServiceContext, input: ListDeadlinesInput): repo.AgendaFilters {
  return {
    ...scope(ctx, input),
    effectiveStatus: input.effectiveStatus,
    status: input.status,
    type: input.type,
    fromLocalDate: input.fromDate,
    untilLocalDate: input.untilDate,
    agentUnchecked: input.agentUnchecked,
  };
}

/** Prazos de um caso, de um processo ou do escritório (agenda), por vencimento. */
export async function listDeadlines(ctx: ServiceContext, input: ListDeadlinesInput): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  return agendaPage(ctx, agendaFilters(ctx, input), input, input.sortDirection !== "desc");
}

/**
 * Planilha de prazos (ADMIN, `data.export`): os MESMOS filtros e ordem da
 * agenda, com o nome do responsável e de quem conferiu o prazo do agente. Fica
 * na auditoria (tipo, filtros e quantidade de linhas; nunca o conteúdo).
 */
export async function exportDeadlines(ctx: ServiceContext, input: ListDeadlinesInput): Promise<ExportFileDTO> {
  requireRead(ctx);
  requirePermission(ctx, "data.export");
  const filters = agendaFilters(ctx, input);
  const ascending = input.sortDirection !== "desc";
  const { rows, total, truncated } = await collectForExport((page) => repo.listAgendaPage(ctx.db, filters, page, ascending));
  const items = rows.map(deadlineFromAgendaRow);
  // Nomes em blocos de 100 (os ids vão na URL da consulta).
  const userIds = [...new Set(items.flatMap((d) => [d.responsibleUserId, d.checkedByUserId]).filter((id): id is string => !!id))];
  const names = new Map((await mapChunks(userIds, 100, (ids) => listProfileNames(ctx.db, ids))).map((p) => [p.id, p.full_name ?? ""]));
  const exportRows: DeadlineExportRow[] = items.map((d) => ({
    ...d,
    responsibleName: d.responsibleUserId ? names.get(d.responsibleUserId) : undefined,
    checkedByName: d.checkedByUserId ? names.get(d.checkedByUserId) : undefined,
  }));
  return exportCsv(ctx, {
    kind: "deadlines",
    fileName: "prazos",
    columns: DEADLINE_EXPORT_COLUMNS,
    rows: exportRows,
    filters: {
      caseId: input.caseId,
      processId: input.processId,
      responsibleUserId: filters.responsibleUserId,
      status: input.status,
      effectiveStatus: input.effectiveStatus,
      type: input.type,
      fromDate: input.fromDate,
      untilDate: input.untilDate,
      agentUnchecked: input.agentUnchecked,
    },
    total,
    truncated,
    // Nome do cliente na planilha: cada cliente fica no registro de acesso (LGPD).
    clientIds: exportRows.map((d) => d.clientId),
  });
}

/** Em aberto e no prazo, vencendo de hoje até hoje + `days` (data local de São Paulo). */
export async function listUpcomingDeadlines(ctx: ServiceContext, input: ListUpcomingInput, now = new Date()): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  const today = officeLocalDate(now);
  return agendaPage(ctx, { ...scope(ctx, input), effectiveStatus: "OPEN", fromLocalDate: today, untilLocalDate: addDays(today, input.days) }, input);
}

/** Vencidos (OPEN com vencimento no passado — derivado no banco), mais antigos primeiro. */
export async function listOverdueDeadlines(ctx: ServiceContext, input: ListOverdueInput): Promise<Page<DeadlineDTO>> {
  requireRead(ctx);
  return agendaPage(ctx, { ...scope(ctx, input), effectiveStatus: "OVERDUE" }, input);
}

export async function getDeadline(ctx: ServiceContext, id: string): Promise<DeadlineDTO> {
  requireRead(ctx);
  const row = await repo.getOne(ctx.db, id);
  if (!row) throw notFound("Prazo não encontrado.");
  return deadlineFromAgendaRow(row);
}

/**
 * Cadastro manual, com chave de envio (reenvio não duplica). Caso
 * obrigatório; processo opcional e do MESMO caso.
 */
export async function createDeadline(ctx: ServiceContext, input: CreateDeadlineInput): Promise<DeadlineCreatedDTO> {
  requireWrite(ctx);
  if (!(await repo.caseVisible(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");
  if (input.processId && !(await repo.processBelongsToCase(ctx.db, input.processId, input.legalCaseId))) {
    throw validation({ processId: ["O processo não pertence a este caso."] }, "O processo não pertence a este caso.");
  }
  const created = await repo.createOnce(ctx.db, input.idempotencyKey, deadlineCreatePayload(input, ctx.session.userId));
  ctx.log.info("deadline.created", { deadlineId: created.deadline_id, legalCaseId: input.legalCaseId, processId: input.processId, deduplicated: created.deduplicated });
  return { id: created.deadline_id, deduplicated: created.deduplicated };
}

/** Edição: só prazo em aberto (prazo encerrado precisa ser reaberto antes). */
export async function updateDeadline(ctx: ServiceContext, input: UpdateDeadlineInput): Promise<void> {
  requireWrite(ctx);
  const status = await repo.getStoredStatus(ctx.db, input.id);
  if (status === null) throw notFound("Prazo não encontrado.");
  if (status !== "OPEN") throw invalidState("Só é possível alterar um prazo em aberto.");
  // Guarda de corrida: só altera se continua OPEN.
  if (!(await repo.updateIfStatus(ctx.db, input.id, "OPEN", deadlineUpdatePatch(input.patch)))) {
    throw invalidState("O prazo foi alterado por outra pessoa. Atualize a página.");
  }
  ctx.log.info("deadline.updated", { deadlineId: input.id });
}

async function transition(ctx: ServiceContext, id: string, action: repo.DeadlineTransition, event: string, reason?: string): Promise<void> {
  requireWrite(ctx);
  await repo.transition(ctx.db, id, action, reason);
  ctx.log.info(event, { deadlineId: id });
}

/** Cumprido. O banco grava a data, quem cumpriu e a auditoria. */
export async function completeDeadline(ctx: ServiceContext, id: string): Promise<void> {
  await transition(ctx, id, "COMPLETE", "deadline.completed");
}

/** Cancelado, com motivo. */
export async function cancelDeadline(ctx: ServiceContext, input: CancelDeadlineInput): Promise<void> {
  await transition(ctx, input.id, "CANCEL", "deadline.cancelled", input.reason);
}

/** Perda do prazo constatada por humano (MISSED). Diferente de "vencido", que é derivado. */
export async function markDeadlineMissed(ctx: ServiceContext, input: MissDeadlineInput): Promise<void> {
  await transition(ctx, input.id, "MISS", "deadline.missed", input.reason);
}

/** Reabre prazo cumprido, cancelado ou perdido. Motivo obrigatório; fica na auditoria. */
export async function reopenDeadline(ctx: ServiceContext, input: ReopenDeadlineInput): Promise<void> {
  await transition(ctx, input.id, "REOPEN", "deadline.reopened", input.reason);
}

/** "Conferido": uma pessoa conferiu o prazo que o agente lançou. Grava quem e quando. */
export async function markDeadlineChecked(ctx: ServiceContext, id: string): Promise<void> {
  requireWrite(ctx);
  await repo.markChecked(ctx.db, id);
  ctx.log.info("deadline.checked", { deadlineId: id });
}
