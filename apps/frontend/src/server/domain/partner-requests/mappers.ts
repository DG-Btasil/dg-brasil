import { PARTNER_REQUEST_TYPE_FROM_DB, PARTNER_REQUEST_TYPE_TO_DB, type DbPartnerRequestType } from "@/repositories/api/db-mappings";
import type { PartnerRequestStatus } from "@/lib/constants/status";
import type { ID } from "@/types";
import type {
  PartnerRequestInternalDTO,
  PartnerRequestListItem,
  PartnerRequestMessageInternalDTO,
  PartnerRequestMessagePartnerDTO,
  PartnerRequestPartnerDTO,
} from "./dto";
import type { CreatePartnerRequestInput } from "./schemas";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * partner-requests.test.ts. A sanitização do parceiro mora AQUI: o mapper
 * do parceiro nem recebe onde pôr dado interno.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface PartnerRequestRow {
  id: string;
  partner_organization_id: string;
  legal_case_id: string;
  legal_process_id: string | null;
  type: DbPartnerRequestType;
  title: string;
  description: string | null;
  due_at: string | null;
  status: PartnerRequestStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  answered_at: string | null;
  resolved_at: string | null;
  /** Título do caso (RLS de quem pergunta). */
  legal_cases?: { title: string } | { title: string }[] | null;
}

export interface PartnerRequestMessageRow {
  id: string;
  author_id: string | null;
  body: string;
  document_id: string | null;
  created_at: string;
}

/** Rótulo do autor interno na visão do parceiro (sem nome nem id de pessoa da equipe). */
export const OWNER_TEAM_LABEL = "Equipe do escritório";
const UNKNOWN_AUTHOR = "Usuário";

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

/* ------------------------------------------------------------------ */
/* Prazo recomendado: data civil ↔ instante                            */
/* ------------------------------------------------------------------ */

/** Data civil (YYYY-MM-DD) → fim do dia em São Paulo (sem horário de verão desde 2019). */
export function dueAtFromDate(date: string): string {
  return `${date}T23:59:59-03:00`;
}

/** Instante → data civil em São Paulo. */
export function dateInSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

function baseFromRow(row: PartnerRequestRow): PartnerRequestListItem {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    caseTitle: (Array.isArray(row.legal_cases) ? row.legal_cases[0] : row.legal_cases)?.title,
    processId: opt(row.legal_process_id),
    type: PARTNER_REQUEST_TYPE_FROM_DB[row.type],
    title: row.title,
    description: opt(row.description),
    status: row.status,
    dueAt: opt(row.due_at),
    dueDate: row.due_at ? dateInSaoPaulo(row.due_at) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    answeredAt: opt(row.answered_at),
    resolvedAt: opt(row.resolved_at),
  };
}

/** Linha da listagem. Para o parceiro, os campos internos não EXISTEM no objeto. */
export function listItemFromRow(row: PartnerRequestRow, surface: "INTERNAL" | "PARTNER"): PartnerRequestListItem {
  const base = baseFromRow(row);
  if (surface === "PARTNER") return base;
  return { ...base, partnerOrganizationId: row.partner_organization_id, createdById: opt(row.created_by) };
}

/** Lado de cada autor: membro do escritório parceiro da solicitação → PARTNER; senão, equipe interna. */
function sideOf(authorId: string | null, partnerAuthorIds: ReadonlySet<string>): "OWNER" | "PARTNER" {
  return authorId && partnerAuthorIds.has(authorId) ? "PARTNER" : "OWNER";
}

export function internalMessagesFromRows(
  rows: PartnerRequestMessageRow[],
  partnerAuthorIds: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): PartnerRequestMessageInternalDTO[] {
  return rows.map((m) => ({
    id: m.id,
    at: m.created_at,
    side: sideOf(m.author_id, partnerAuthorIds),
    author: { id: m.author_id ?? "", name: (m.author_id && names.get(m.author_id)) || UNKNOWN_AUTHOR },
    message: m.body,
    documentId: opt(m.document_id),
  }));
}

/**
 * Visão do parceiro: autor interno vira "equipe do escritório" (sem id/nome de
 * pessoa da equipe) e documento que ele não pode abrir some da mensagem.
 */
export function partnerMessagesFromRows(
  rows: PartnerRequestMessageRow[],
  partnerAuthorIds: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
  readableDocumentIds: ReadonlySet<string>,
): PartnerRequestMessagePartnerDTO[] {
  return rows.map((m) => {
    const side = sideOf(m.author_id, partnerAuthorIds);
    const out: PartnerRequestMessagePartnerDTO = {
      id: m.id,
      at: m.created_at,
      side,
      authorName: side === "OWNER" ? OWNER_TEAM_LABEL : (m.author_id && names.get(m.author_id)) || UNKNOWN_AUTHOR,
      message: m.body,
    };
    if (m.document_id && readableDocumentIds.has(m.document_id)) out.documentId = m.document_id;
    return out;
  });
}

export function internalDetailFromRows(
  row: PartnerRequestRow,
  messages: PartnerRequestMessageRow[],
  partnerAuthorIds: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): PartnerRequestInternalDTO {
  return {
    ...baseFromRow(row),
    partnerOrganizationId: row.partner_organization_id,
    createdById: opt(row.created_by),
    messages: internalMessagesFromRows(messages, partnerAuthorIds, names),
  };
}

export function partnerDetailFromRows(
  row: PartnerRequestRow,
  messages: PartnerRequestMessageRow[],
  partnerAuthorIds: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
  readableDocumentIds: ReadonlySet<string>,
): PartnerRequestPartnerDTO {
  return { ...baseFromRow(row), messages: partnerMessagesFromRows(messages, partnerAuthorIds, names, readableDocumentIds) };
}

/* ------------------------------------------------------------------ */
/* Domínio → linha de inserção                                         */
/* ------------------------------------------------------------------ */

/** `partnerOrganizationId` vem do CASO (lido no banco), nunca do navegador. */
export function insertRow(id: ID, input: CreatePartnerRequestInput, partnerOrganizationId: ID): Record<string, unknown> {
  return {
    id,
    partner_organization_id: partnerOrganizationId,
    legal_case_id: input.legalCaseId,
    legal_process_id: input.processId ?? null,
    type: PARTNER_REQUEST_TYPE_TO_DB[input.type],
    title: input.title,
    description: input.description ?? null,
    due_at: input.dueDate ? dueAtFromDate(input.dueDate) : null,
  };
}
