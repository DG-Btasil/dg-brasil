import { randomUUID } from "node:crypto";
import { can } from "@/lib/permissions";
import { isPartner, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { forbidden, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import { deadlineInsertRow } from "./deadlines/mappers";
import type { ProcessCreatedDTO, ProcessDetailDTO, ProcessEventDTO, ProcessListItem, ProcessPartyDTO } from "./dto";
import {
  eventFromRow,
  internalDetailsPatch,
  internalDetailsRow,
  internalProcessFromRows,
  listItemFromRow,
  manualEventRow,
  partnerProcessFromRow,
  partyFromRow,
  partyInsertRow,
  partyUpdatePatch,
  processInsertRow,
  processUpdatePatch,
} from "./mappers";
import * as repo from "./repository";
import type {
  AddPartyInput,
  CreateEventInput,
  CreatePartnerProcessInput,
  CreateProcessInput,
  ListCaseProcessesInput,
  ListEventsInput,
  ListPartiesInput,
  ListProcessesInput,
  UpdatePartyInput,
  UpdateProcessInput,
} from "./schemas";

/**
 * Regras de Processo, Partes e Movimentações. Autorização contextual aqui;
 * RLS e triggers do banco como segunda barreira — e as invariantes de dado
 * (processo nunca muda de caso, CNJ único, responsável interno ativo, só ADMIN
 * exclui) continuam NO BANCO, não reimplementadas aqui.
 *
 * Processo SEMPRE pertence a um caso que o usuário acessa (parceiro: só os
 * casos do próprio escritório). Para o parceiro, "não acessa" = "não existe".
 */

/** Origens de movimentação que o parceiro vê (mesma regra da RLS e de lib/permissions/partner-scope). */
export const PARTNER_EVENT_SOURCES = ["JUDICIAL_INTEGRATION", "IMPORT", "SYSTEM"] as const;

const canViewCaseValue = (ctx: ServiceContext) => can(ctx.session.role, "processes.caseValue.view");
const scopeOf = (ctx: ServiceContext) => (isPartner(ctx) ? "PARTNER" : "INTERNAL");

/** Processo visível e não excluído, ou NOT_FOUND (sem dizer se existe para outro escritório). */
async function requireProcess(ctx: ServiceContext, id: string) {
  const ref = await repo.getProcessRef(ctx.db, id);
  if (!ref) throw notFound("Processo não encontrado.");
  return ref;
}

/* ------------------------------------------------------------------ */
/* Processos                                                           */
/* ------------------------------------------------------------------ */

export async function listProcesses(ctx: ServiceContext, input: ListProcessesInput): Promise<Page<ProcessListItem>> {
  requirePermission(ctx, "processes.view");
  const scope = scopeOf(ctx);
  const viewer = { surface: scope, canViewCaseValue: canViewCaseValue(ctx) } as const;
  const { rows, total } = await repo.listProcesses(
    ctx.db,
    repo.processColumns(scope, viewer.canViewCaseValue),
    {
      q: input.q,
      status: input.status,
      clientId: input.clientId,
      caseId: input.caseId,
      // Parceiro não filtra por responsável interno; a RLS já limita aos casos dele.
      responsibleUserId: scope === "INTERNAL" ? input.responsibleUserId : undefined,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  return toPage(
    rows.map((r) => listItemFromRow(r, viewer)),
    total,
    input,
  );
}

/** Processos de um caso que o usuário acessa (caso inexistente/alheio → NOT_FOUND). */
export async function listCaseProcesses(ctx: ServiceContext, input: ListCaseProcessesInput): Promise<Page<ProcessListItem>> {
  requirePermission(ctx, "processes.view");
  if (!(await repo.getCaseRef(ctx.db, input.caseId))) throw notFound("Caso não encontrado.");
  const scope = scopeOf(ctx);
  const viewer = { surface: scope, canViewCaseValue: canViewCaseValue(ctx) } as const;
  const { rows, total } = await repo.listProcesses(ctx.db, repo.processColumns(scope, viewer.canViewCaseValue), { caseId: input.caseId }, input, {
    column: "created_at",
    ascending: true,
  });
  return toPage(
    rows.map((r) => listItemFromRow(r, viewer)),
    total,
    input,
  );
}

/**
 * Ficha do processo, com DTO por superfície: parceiro nunca recebe
 * legal_process_internal_details (nem a consulta é feita). Registra o acesso
 * (LGPD) ao processo do cliente antes de devolver.
 */
export async function getProcess(ctx: ServiceContext, id: string): Promise<ProcessDetailDTO> {
  requirePermission(ctx, "processes.view");
  const scope = scopeOf(ctx);
  const withCaseValue = canViewCaseValue(ctx);
  const row = await repo.getProcess(ctx.db, id, repo.processColumns(scope, withCaseValue));
  if (!row) throw notFound("Processo não encontrado.");
  const clientId = (Array.isArray(row.legal_cases) ? row.legal_cases[0] : row.legal_cases)?.client_id;
  if (clientId) await repo.recordDetailAccess(ctx.db, clientId, id);
  if (scope === "PARTNER") return { surface: "PARTNER", process: partnerProcessFromRow(row, withCaseValue) };
  const internal = await repo.getInternalDetails(ctx.db, id);
  return { surface: "INTERNAL", process: internalProcessFromRows(row, internal, withCaseValue) };
}

/**
 * Cadastro interno (ADMIN/LAWYER). Sem caso acessível não há processo (nunca
 * órfão). CNJ duplicado → CONFLICT amigável (unique legal_processes_cnj_key).
 */
export async function createProcess(ctx: ServiceContext, input: CreateProcessInput): Promise<ProcessCreatedDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
  if (!(await repo.getCaseRef(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");

  const responsible = input.responsibleUserId ?? ctx.session.userId;
  const process = withoutKeys(processInsertRow("", { ...input, responsibleUserId: responsible }, "INTERNAL"), "id", "technical_origin");
  const details = internalDetailsRow("", input);
  const deadline = input.nextDeadline
    ? withoutKeys(
        deadlineInsertRow(
          "",
          { legalCaseId: input.legalCaseId, title: input.nextDeadline.title, type: input.nextDeadline.type, dueDate: input.nextDeadline.dueDate, priority: "NORMAL" },
          responsible,
        ),
        "id",
        "legal_case_id",
        "legal_process_id",
        "source",
      )
    : null;
  // Processo + dados internos + prazo inicial numa transação; a chave de envio
  // faz a repetição devolver o mesmo processo (migration 027).
  const r = await repo.createProcessOnce(ctx.db, input.idempotencyKey, process, details ? withoutKeys(details, "legal_process_id") : null, deadline);
  ctx.log.info(r.deduplicated ? "process.create_replayed" : "process.created", {
    processId: r.legal_process_id,
    deadlineId: r.deadline_id ?? undefined,
    legalCaseId: input.legalCaseId,
    idempotencyKey: input.idempotencyKey,
  });
  return { id: r.legal_process_id, deduplicated: r.deduplicated };
}

/**
 * Portal do Parceiro: processo para um caso do PRÓPRIO escritório (RLS
 * legal_processes_insert_partner: origem MANUAL e caso acessível). Sem campo
 * interno (status, fase, responsável) — o banco aplica os defaults, mesmo se
 * a função for chamada direto.
 */
export async function createPartnerProcess(ctx: ServiceContext, input: CreatePartnerProcessInput): Promise<ProcessCreatedDTO> {
  if (!isPartner(ctx)) throw forbidden();
  requirePermission(ctx, "partnerPortal.processes.create");
  if (!(await repo.getCaseRef(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");
  const process = withoutKeys(processInsertRow("", input, "PARTNER"), "id", "technical_origin");
  const r = await repo.createProcessOnce(ctx.db, input.idempotencyKey, process, null, null);
  ctx.log.info(r.deduplicated ? "process.create_replayed" : "process.created", {
    processId: r.legal_process_id,
    legalCaseId: input.legalCaseId,
    idempotencyKey: input.idempotencyKey,
  });
  return { id: r.legal_process_id, deduplicated: r.deduplicated };
}

/** Copia sem as chaves geradas pelo banco (id, origem técnica...). */
function withoutKeys<T extends Record<string, unknown>>(row: T, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) delete out[k];
  return out;
}

/** Edição interna (ADMIN/LAWYER). O caso do processo não muda (trigger). */
export async function updateProcess(ctx: ServiceContext, input: UpdateProcessInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
  await requireProcess(ctx, input.id);
  const patch = processUpdatePatch(input.patch);
  if (Object.keys(patch).length > 0) await repo.updateProcess(ctx.db, input.id, patch);
  const details = internalDetailsPatch(input.id, input.patch);
  if (details) await repo.upsertInternalDetails(ctx.db, details);
  ctx.log.info("process.updated", { processId: input.id });
}

/** Exclusão lógica (ADMIN; o trigger também recusa os demais). Prazos e movimentações ficam. */
export async function removeProcess(ctx: ServiceContext, id: string): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.delete");
  await repo.softDelete(ctx.db, id);
  ctx.log.info("process.deleted", { processId: id });
}

/* ------------------------------------------------------------------ */
/* Partes                                                              */
/* ------------------------------------------------------------------ */

export async function listParties(ctx: ServiceContext, input: ListPartiesInput): Promise<Page<ProcessPartyDTO>> {
  requirePermission(ctx, "processes.view");
  await requireProcess(ctx, input.processId);
  const { rows, total } = await repo.listParties(ctx.db, input.processId, input);
  return toPage(rows.map(partyFromRow), total, input);
}

/** Cliente informado como parte precisa ser um cliente que o usuário acessa. */
async function requireVisibleClient(ctx: ServiceContext, clientId: string | null | undefined) {
  if (clientId && !(await repo.clientVisible(ctx.db, clientId))) throw notFound("Cliente não encontrado.");
}

/** Interno: ADMIN/LAWYER. Parceiro: em processo de caso do próprio escritório (RLS process_parties_insert). */
export async function addParty(ctx: ServiceContext, input: AddPartyInput): Promise<{ id: string }> {
  if (isPartner(ctx)) requirePermission(ctx, "partnerPortal.processes.create");
  else requirePermission(ctx, "processes.edit");
  await requireProcess(ctx, input.processId);
  await requireVisibleClient(ctx, input.clientId);
  const id = randomUUID();
  await repo.insertParty(ctx.db, partyInsertRow(id, input));
  ctx.log.info("process.party_added", { processId: input.processId, partyId: id });
  return { id };
}

/** Só ADMIN/LAWYER (RLS process_parties_update). */
export async function updateParty(ctx: ServiceContext, input: UpdatePartyInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
  const processId = await repo.getPartyProcessId(ctx.db, input.id);
  if (!processId) throw notFound("Parte não encontrada.");
  await requireProcess(ctx, processId);
  await requireVisibleClient(ctx, input.patch.clientId);
  await repo.updateParty(ctx.db, input.id, partyUpdatePatch(input.patch));
  ctx.log.info("process.party_updated", { processId, partyId: input.id });
}

/* ------------------------------------------------------------------ */
/* Movimentações                                                       */
/* ------------------------------------------------------------------ */

/** Interno: todas. Parceiro: só oficiais (tribunal/importação) e do sistema. */
export async function listEvents(ctx: ServiceContext, input: ListEventsInput): Promise<Page<ProcessEventDTO>> {
  requirePermission(ctx, "processes.view");
  await requireProcess(ctx, input.processId);
  const scope = scopeOf(ctx);
  const { rows, total } = await repo.listEvents(ctx.db, input.processId, input, {
    internal: scope === "INTERNAL",
    sources: scope === "PARTNER" ? PARTNER_EVENT_SOURCES : undefined,
  });
  return toPage(
    rows.map((r) => eventFromRow(r, scope)),
    total,
    input,
  );
}

/**
 * Movimentação manual (nota da equipe) — ADMIN/LAWYER. A origem é sempre
 * MANUAL: ninguém digita movimentação "oficial" (JUDICIAL_INTEGRATION/IMPORT
 * só pela integração). Parceiro não registra movimentação (RLS também recusa).
 */
export async function createEvent(ctx: ServiceContext, input: CreateEventInput, now = new Date()): Promise<{ id: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "processes.edit");
  await requireProcess(ctx, input.processId);
  const id = randomUUID();
  await repo.insertEvent(ctx.db, manualEventRow(id, input, now));
  ctx.log.info("process.event_created", { processId: input.processId, eventId: id });
  return { id };
}
