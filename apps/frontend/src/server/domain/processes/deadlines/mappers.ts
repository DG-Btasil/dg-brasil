import type { DeadlineStatus, DeadlineType, HearingMode } from "@/lib/constants/status";
import type { ID } from "@/types";
import type { DeadlineDTO } from "./dto";
import type { CreateDeadlineInput, DeadlineEffectiveStatus, DeadlinePriority, UpdateDeadlineInput } from "./schemas";

/** Banco ↔ domínio para Prazos. Funções puras (deadlines.test.ts). */

export const OFFICE_TIME_ZONE = "America/Sao_Paulo";
/**
 * Brasília não tem horário de verão desde 2019: data civil → fim do dia em
 * -03:00. Se o horário de verão voltar, trocar por conversão com fuso.
 */
const OFFICE_UTC_OFFSET = "-03:00";

/** Linha da view `deadline_agenda` (migration 063): prazo + situação efetiva + cliente, caso e processo. */
export interface DeadlineAgendaRow {
  id: string;
  legal_case_id: string;
  legal_process_id: string | null;
  title: string;
  deadline_type: DeadlineType;
  description: string | null;
  due_at: string;
  due_date_local: string;
  priority: DeadlinePriority;
  status: DeadlineStatus;
  effective_status: DeadlineEffectiveStatus;
  responsible_user_id: string | null;
  source: DeadlineDTO["source"];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  status_reason: string | null;
  status_changed_at: string | null;
  status_changed_by: string | null;
  checked_at: string | null;
  checked_by: string | null;
  agent_unchecked: boolean;
  hearing_mode: HearingMode | null;
  hearing_location: string | null;
  hearing_link: string | null;
  case_title: string | null;
  client_id: string | null;
  client_name: string | null;
  process_title: string | null;
  process_cnj: string | null;
  process_court: string | null;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

const officeTimeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: OFFICE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Hora (HH:MM) de um instante no fuso do escritório. */
export function officeLocalTime(at: string | Date): string {
  return officeTimeFmt.format(typeof at === "string" ? new Date(at) : at);
}

export function deadlineFromAgendaRow(row: DeadlineAgendaRow): DeadlineDTO {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    processId: opt(row.legal_process_id),
    title: row.title,
    type: row.deadline_type,
    description: opt(row.description),
    dueAt: row.due_at,
    dueDateLocal: row.due_date_local,
    dueTimeLocal: officeLocalTime(row.due_at),
    priority: row.priority,
    status: row.status,
    effectiveStatus: row.effective_status,
    responsibleUserId: opt(row.responsible_user_id),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: opt(row.completed_at),
    statusReason: opt(row.status_reason),
    statusChangedAt: opt(row.status_changed_at),
    statusChangedByUserId: opt(row.status_changed_by),
    agentUnchecked: row.agent_unchecked,
    checkedAt: opt(row.checked_at),
    checkedByUserId: opt(row.checked_by),
    hearingMode: opt(row.hearing_mode),
    hearingLocation: opt(row.hearing_location),
    hearingLink: opt(row.hearing_link),
    caseTitle: opt(row.case_title),
    clientId: opt(row.client_id),
    clientName: opt(row.client_name),
    processTitle: opt(row.process_title),
    processCnj: opt(row.process_cnj),
    processCourt: opt(row.process_court),
  };
}

/** Filtro de responsável: "me" vira o usuário da sessão (nunca confiado do navegador). */
export function resolveResponsible(value: string | undefined, sessionUserId: ID): ID | undefined {
  if (!value) return undefined;
  return value === "me" ? sessionUserId : value;
}

/** Data civil (YYYY-MM-DD) de um instante no fuso do escritório. */
export function officeLocalDate(at: Date): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Soma dias a uma data civil (sem fuso). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Vencimento informado → timestamptz. Data civil = 23:59:59 em Brasília; com
 * hora (audiência), a hora informada em Brasília.
 */
export function dueAtFromInput(input: { dueAt?: string; dueDate?: string; dueTime?: string }): string | undefined {
  if (input.dueAt) return input.dueAt;
  if (input.dueDate) return `${input.dueDate}T${input.dueTime ? `${input.dueTime}:00` : "23:59:59"}${OFFICE_UTC_OFFSET}`;
  return undefined;
}

type Json = Record<string, unknown>;

/** Campos de prazo que os dois caminhos de criação usam (a chave de envio fica de fora). */
type DeadlineFields = Pick<CreateDeadlineInput, "legalCaseId" | "processId" | "title" | "type" | "description" | "dueAt" | "dueDate" | "dueTime" | "priority" | "responsibleUserId">;

/**
 * Linha nova de deadlines. `status` fica no default (OPEN) e `source` é
 * sempre MANUAL: prazo de integração/agente não é digitado. Usada também pelo
 * prazo inicial do cadastro de processo (create_legal_process_once).
 */
export function deadlineInsertRow(id: ID, input: DeadlineFields, responsibleUserId: ID): Json {
  return {
    id,
    legal_case_id: input.legalCaseId,
    legal_process_id: input.processId ?? null,
    title: input.title,
    deadline_type: input.type,
    description: input.description ?? null,
    due_at: dueAtFromInput(input),
    priority: input.priority,
    responsible_user_id: input.responsibleUserId ?? responsibleUserId,
    source: "MANUAL",
  };
}

/** Modalidade, local e link só ficam gravados quando o tipo é Audiência. */
function hearingColumns(type: DeadlineType | undefined, input: { hearingMode?: HearingMode | null; hearingLocation?: string | null; hearingLink?: string | null }): Json {
  if (type !== "HEARING") return { hearing_mode: null, hearing_location: null, hearing_link: null };
  return { hearing_mode: input.hearingMode ?? null, hearing_location: input.hearingLocation ?? null, hearing_link: input.hearingLink ?? null };
}

/**
 * Pedido de `create_deadline_once` (migration 063). Montagem determinística:
 * o mesmo formulário reenviado gera o mesmo JSON (sem id, sem "agora"), para a
 * chave de envio reconhecer a repetição.
 */
export function deadlineCreatePayload(input: CreateDeadlineInput, responsibleUserId: ID): Json {
  const { id: _id, source: _source, ...row } = deadlineInsertRow("", input, responsibleUserId);
  void _id;
  void _source;
  return { ...row, ...hearingColumns(input.type, input) };
}

/** PATCH: só chaves presentes; null limpa. Status não passa por aqui (cumprir, cancelar, perder e reabrir têm operação própria). */
export function deadlineUpdatePatch(patch: UpdateDeadlineInput["patch"]): Json {
  const out: Json = {};
  const p = patch as Record<string, unknown>;
  if ("title" in p) out.title = patch.title;
  if ("type" in p) out.deadline_type = patch.type;
  if ("description" in p) out.description = patch.description ?? null;
  if ("priority" in p) out.priority = patch.priority;
  if ("responsibleUserId" in p) out.responsible_user_id = patch.responsibleUserId ?? null;
  const dueAt = dueAtFromInput(patch);
  if (dueAt) out.due_at = dueAt;
  // Trocou para um tipo que não é audiência: os dados da audiência saem junto.
  if ("type" in p && patch.type !== "HEARING") Object.assign(out, hearingColumns(patch.type, {}));
  else {
    if ("hearingMode" in p) out.hearing_mode = patch.hearingMode ?? null;
    if ("hearingLocation" in p) out.hearing_location = patch.hearingLocation ?? null;
    if ("hearingLink" in p) out.hearing_link = patch.hearingLink ?? null;
  }
  return out;
}
