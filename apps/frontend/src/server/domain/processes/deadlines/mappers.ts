import type { DeadlineStatus, DeadlineType } from "@/lib/constants/status";
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

export interface DeadlineRow {
  id: string;
  legal_case_id: string;
  legal_process_id: string | null;
  title: string;
  deadline_type: DeadlineType;
  description: string | null;
  due_at: string;
  priority: DeadlinePriority;
  status: DeadlineStatus;
  responsible_user_id: string | null;
  source: DeadlineDTO["source"];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Linha da view deadline_status (estado derivado, nunca gravado). */
export interface DeadlineStatusRow {
  deadline_id: string;
  effective_status: DeadlineEffectiveStatus;
  due_date_local: string;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function deadlineFromRows(row: DeadlineRow, status: DeadlineStatusRow): DeadlineDTO {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    processId: opt(row.legal_process_id),
    title: row.title,
    type: row.deadline_type,
    description: opt(row.description),
    dueAt: row.due_at,
    dueDateLocal: status.due_date_local,
    priority: row.priority,
    status: row.status,
    effectiveStatus: status.effective_status,
    responsibleUserId: opt(row.responsible_user_id),
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: opt(row.completed_at),
  };
}

/**
 * Junta a página da view (que manda na ordem e no total) com as linhas da
 * tabela. Linha que sumiu entre as duas leituras é descartada. Dentro da
 * página, ordena pelo instante do vencimento (a view só tem a data local).
 */
export function mergePage(statusRows: DeadlineStatusRow[], rows: DeadlineRow[], ascending = true): DeadlineDTO[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = statusRows.flatMap((s) => {
    const row = byId.get(s.deadline_id);
    return row ? [deadlineFromRows(row, s)] : [];
  });
  const dir = ascending ? 1 : -1;
  // A view já vem ordenada pela data local; aqui só desempata pelo horário (sort é estável).
  return items.sort((a, b) => dir * (a.dueDateLocal.localeCompare(b.dueDateLocal) || Date.parse(a.dueAt) - Date.parse(b.dueAt)));
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

/** Vencimento informado → timestamptz. Data civil = 23:59:59 em Brasília. */
export function dueAtFromInput(input: { dueAt?: string; dueDate?: string }): string | undefined {
  if (input.dueAt) return input.dueAt;
  if (input.dueDate) return `${input.dueDate}T23:59:59${OFFICE_UTC_OFFSET}`;
  return undefined;
}

type Json = Record<string, unknown>;

/**
 * Linha nova de deadlines. `status` fica no default (OPEN) e `source` é
 * sempre MANUAL: prazo de integração/agente não é digitado.
 */
export function deadlineInsertRow(id: ID, input: CreateDeadlineInput, responsibleUserId: ID): Json {
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

/** PATCH: só chaves presentes; null limpa. Status não passa por aqui (complete/cancel/missed). */
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
  return out;
}
