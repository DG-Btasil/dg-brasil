import type { ClientPole, ProcessEventSource, ProcessOrigin, ProcessPhase } from "@/lib/constants/status";
import { processStatusFromDb, type DbProcessStatus } from "@/repositories/api/db-mappings";
import type { ID } from "@/types";
import type { ProcessEventDTO, ProcessInternalDTO, ProcessListItem, ProcessPartnerDTO, ProcessPartyDTO } from "./dto";
import type { AddPartyInput, CreatePartnerProcessInput, CreateProcessInput, PartyType, UpdatePartyInput, UpdateProcessInput } from "./schemas";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * processes.test.ts. Componentes React nunca veem nome de coluna.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

interface CaseRefRow {
  client_id: string;
}

/** Colunas que as duas superfícies leem (legal_processes + cliente do caso). */
export interface ProcessRow {
  id: string;
  legal_case_id: string;
  title: string | null;
  cnj_number: string | null;
  technical_origin: ProcessOrigin;
  court: string | null;
  court_unit: string | null;
  district: string | null;
  state: string | null;
  legal_class: string | null;
  subject: string | null;
  client_side: ClientPole | null;
  adverse_party_summary: string | null;
  /** Só selecionado quando o papel pode ver o valor da causa. numeric chega como string ou number. */
  case_value?: number | string | null;
  currency: string;
  status: DbProcessStatus;
  phase: ProcessPhase | null;
  distribution_date: string | null;
  created_at: string;
  updated_at: string;
  legal_cases: CaseRefRow | CaseRefRow[] | null;
  /** Só na leitura interna. */
  responsible_user_id?: string | null;
  operational_due_at?: string | null;
  created_by?: string | null;
}

export interface ProcessInternalRow {
  summary: string | null;
  notes: string | null;
}

export interface PartyRow {
  id: string;
  legal_process_id: string;
  party_type: PartyType;
  name: string;
  document_number: string | null;
  client_id: string | null;
  created_at: string;
}

export interface EventRow {
  id: string;
  legal_process_id: string;
  event_type: string;
  title: string | null;
  description: string;
  occurred_at: string;
  source: ProcessEventSource;
  important: boolean;
  created_at: string;
  external_provider?: string | null;
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const money = (v: number | string | null | undefined): number | undefined => (v === null || v === undefined ? undefined : Number(v));

export interface ProcessViewer {
  surface: "INTERNAL" | "PARTNER";
  /** `processes.caseValue.view` na matriz central. */
  canViewCaseValue: boolean;
}

export function listItemFromRow(row: ProcessRow, viewer: ProcessViewer): ProcessListItem {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    clientId: one(row.legal_cases)?.client_id ?? "",
    cnj: opt(row.cnj_number),
    title: row.title ?? "",
    court: opt(row.court),
    state: opt(row.state),
    status: processStatusFromDb(row.status),
    dbStatus: row.status,
    phase: opt(row.phase),
    distributionDate: opt(row.distribution_date),
    caseValue: viewer.canViewCaseValue ? money(row.case_value) : undefined,
    responsibleUserId: viewer.surface === "INTERNAL" ? opt(row.responsible_user_id) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function baseFromRow(row: ProcessRow, canViewCaseValue: boolean): ProcessPartnerDTO {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    clientId: one(row.legal_cases)?.client_id ?? "",
    cnj: opt(row.cnj_number),
    title: row.title ?? "",
    court: opt(row.court),
    unit: opt(row.court_unit),
    district: opt(row.district),
    state: opt(row.state),
    actionType: opt(row.legal_class),
    subject: opt(row.subject),
    clientPole: opt(row.client_side),
    opposingParty: opt(row.adverse_party_summary),
    caseValue: canViewCaseValue ? money(row.case_value) : undefined,
    currency: row.currency,
    status: processStatusFromDb(row.status),
    dbStatus: row.status,
    phase: opt(row.phase),
    origin: row.technical_origin,
    distributionDate: opt(row.distribution_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ficha interna: base + responsável, prazo operacional, autor e dados internos. */
export function internalProcessFromRows(row: ProcessRow, internalRow: ProcessInternalRow | null, canViewCaseValue: boolean): ProcessInternalDTO {
  return {
    ...baseFromRow(row, canViewCaseValue),
    responsibleUserId: opt(row.responsible_user_id),
    operationalDueAt: opt(row.operational_due_at),
    createdBy: opt(row.created_by),
    summary: opt(internalRow?.summary),
    notes: opt(internalRow?.notes),
  };
}

/**
 * Ficha do parceiro. Monta campo a campo (lista fechada): mesmo que a linha
 * traga coluna interna por engano, ela não tem onde entrar no DTO.
 */
export function partnerProcessFromRow(row: ProcessRow, canViewCaseValue: boolean): ProcessPartnerDTO {
  return baseFromRow(row, canViewCaseValue);
}

export function partyFromRow(row: PartyRow): ProcessPartyDTO {
  return {
    id: row.id,
    processId: row.legal_process_id,
    type: row.party_type,
    name: row.name,
    document: opt(row.document_number),
    clientId: opt(row.client_id),
    createdAt: row.created_at,
  };
}

export function eventFromRow(row: EventRow, surface: "INTERNAL" | "PARTNER"): ProcessEventDTO {
  return {
    id: row.id,
    processId: row.legal_process_id,
    type: row.event_type,
    title: opt(row.title),
    description: row.description,
    occurredAt: row.occurred_at,
    source: row.source,
    important: row.important,
    createdAt: row.created_at,
    // Parceiro não recebe nem a chave (o DTO não carrega dado de integração).
    ...(surface === "INTERNAL" && row.external_provider ? { externalProvider: row.external_provider } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Domínio → colunas (insert/update diretos; RLS + triggers conferem)  */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

/** Campo do domínio → coluna de legal_processes. */
const PROCESS_FIELD_TO_COLUMN: Record<string, string> = {
  title: "title",
  cnj: "cnj_number",
  court: "court",
  unit: "court_unit",
  district: "district",
  state: "state",
  actionType: "legal_class",
  subject: "subject",
  clientPole: "client_side",
  opposingParty: "adverse_party_summary",
  distributionDate: "distribution_date",
  caseValue: "case_value",
  status: "status",
  phase: "phase",
  responsibleUserId: "responsible_user_id",
  operationalDueAt: "operational_due_at",
};

/** O que o parceiro pode gravar no cadastro: nada de status, fase, responsável ou prazo operacional. */
const PARTNER_WRITABLE = new Set([
  "title",
  "cnj",
  "court",
  "unit",
  "district",
  "state",
  "actionType",
  "subject",
  "clientPole",
  "opposingParty",
  "distributionDate",
  "caseValue",
]);
const PARTNER_FIELD_TO_COLUMN = Object.fromEntries(Object.entries(PROCESS_FIELD_TO_COLUMN).filter(([field]) => PARTNER_WRITABLE.has(field)));

/** Campos que vão para legal_process_internal_details. */
const INTERNAL_DETAIL_FIELDS: Record<string, string> = { summary: "summary", notes: "notes" };

function copy(source: Record<string, unknown>, map: Record<string, string>, out: Json) {
  for (const [field, column] of Object.entries(map)) {
    if (field in source) out[column] = source[field] ?? null;
  }
}

/**
 * Linha nova de legal_processes. `technical_origin` é sempre MANUAL (cadastro
 * pela tela); o id é gerado no servidor (inserção sem RETURNING — contrato do
 * banco para inserção de parceiro). `created_by` vem do trigger (auth.uid()).
 */
export function processInsertRow(id: ID, input: CreateProcessInput | CreatePartnerProcessInput, scope: "INTERNAL" | "PARTNER"): Json {
  const out: Json = { id, legal_case_id: input.legalCaseId, technical_origin: "MANUAL" };
  // Parceiro: lista fechada, mesmo que o objeto traga chave interna.
  copy(input as Record<string, unknown>, scope === "PARTNER" ? PARTNER_FIELD_TO_COLUMN : PROCESS_FIELD_TO_COLUMN, out);
  // Nada indefinido vai para o banco: coluna ausente usa o default (status PREPARING etc.).
  for (const key of Object.keys(out)) if (out[key] === null || out[key] === undefined) delete out[key];
  return out;
}

/** Dados internos do cadastro (null quando não há nada a gravar). */
export function internalDetailsRow(id: ID, input: { summary?: string | null; notes?: string | null }): Json | null {
  const out: Json = {};
  copy(input as Record<string, unknown>, INTERNAL_DETAIL_FIELDS, out);
  if (Object.keys(out).length === 0) return null;
  return { legal_process_id: id, ...out };
}

/** PATCH de legal_processes: só as chaves presentes; null limpa. */
export function processUpdatePatch(patch: UpdateProcessInput["patch"]): Json {
  const out: Json = {};
  copy(patch as Record<string, unknown>, PROCESS_FIELD_TO_COLUMN, out);
  return out;
}

/** PATCH dos dados internos (null quando o patch não toca neles). */
export function internalDetailsPatch(id: ID, patch: UpdateProcessInput["patch"]): Json | null {
  const p = patch as Record<string, unknown>;
  if (!("summary" in p) && !("notes" in p)) return null;
  const out: Json = { legal_process_id: id };
  copy(p, INTERNAL_DETAIL_FIELDS, out);
  return out;
}

export function partyInsertRow(id: ID, input: AddPartyInput): Json {
  return {
    id,
    legal_process_id: input.processId,
    party_type: input.type,
    name: input.name,
    document_number: input.document ?? null,
    client_id: input.clientId ?? null,
  };
}

const PARTY_FIELD_TO_COLUMN: Record<string, string> = { type: "party_type", name: "name", document: "document_number", clientId: "client_id" };

export function partyUpdatePatch(patch: UpdatePartyInput["patch"]): Json {
  const out: Json = {};
  copy(patch as Record<string, unknown>, PARTY_FIELD_TO_COLUMN, out);
  return out;
}

/**
 * Movimentação manual. `source` é fixo (MANUAL) e não vem do input; sem
 * provedor/ID externo nem `raw_data` (exclusivos da integração).
 */
export function manualEventRow(
  id: ID,
  input: { processId: ID; title: string; description?: string; occurredAt?: string; important: boolean; eventType: string },
  now: Date,
): Json {
  return {
    id,
    legal_process_id: input.processId,
    event_type: input.eventType,
    title: input.title,
    // description é obrigatória no banco: sem texto próprio, repete o título.
    description: input.description ?? input.title,
    occurred_at: input.occurredAt ?? now.toISOString(),
    source: "MANUAL",
    important: input.important,
  };
}
