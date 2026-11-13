import type { RestoreResultDTO, TrashBlockReason, TrashItemDTO } from "./dto";
import type { TrashKind } from "./schemas";

/** Linha de public.trash_list (066). Os campos variam com o tipo. */
export interface TrashRow {
  id: string;
  kind: TrashKind;
  title: string | null;
  deleted_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  blocked: string | null;
  document?: string | null;
  client_kind?: "INDIVIDUAL" | "COMPANY" | null;
  cnj?: string | null;
  cnj_released?: boolean | null;
  case_title?: string | null;
  client_name?: string | null;
  category_label?: string | null;
}

const BLOCK_REASONS: readonly TrashBlockReason[] = ["CLIENT_DELETED", "CASE_DELETED", "CNJ_IN_USE"];
const opt = (v: string | null | undefined) => (v && v.trim() ? v : undefined);

export function trashItemFromRow(row: TrashRow): TrashItemDTO {
  const blocked = BLOCK_REASONS.find((r) => r === row.blocked);
  return {
    id: row.id,
    kind: row.kind,
    title: opt(row.title) ?? "(sem nome)",
    deletedAt: row.deleted_at,
    deletedByName: opt(row.deleted_by_name),
    ...(blocked ? { blocked } : {}),
    ...(row.kind === "CLIENT" ? { document: opt(row.document), clientKind: row.client_kind ?? undefined } : {}),
    ...(row.kind === "PROCESS" ? { cnj: opt(row.cnj), cnjReleased: row.cnj_released === true, caseTitle: opt(row.case_title), clientName: opt(row.client_name) } : {}),
    ...(row.kind === "DOCUMENT" ? { clientName: opt(row.client_name), categoryLabel: opt(row.category_label) } : {}),
  };
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Retorno (jsonb) de restore_client / restore_process / restore_document → DTO. */
export function restoreResultFromRow(kind: TrashKind, raw: Record<string, unknown>): RestoreResultDTO {
  const id = String(raw.id ?? "");
  if (kind === "CLIENT") {
    return {
      kind,
      id,
      cases: count(raw.cases),
      processes: count(raw.processes),
      documents: count(raw.documents),
      trashedProcesses: count(raw.trashed_processes),
      trashedDocuments: count(raw.trashed_documents),
    };
  }
  if (kind === "PROCESS") {
    return { kind, id, legalCaseId: String(raw.legal_case_id ?? ""), cnjReturned: raw.cnj_returned === true, openDeadlines: count(raw.open_deadlines) };
  }
  return { kind, id, clientId: String(raw.client_id ?? "") };
}
