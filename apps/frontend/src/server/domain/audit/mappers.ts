import type { ActorType } from "@/types";
import type { AuditEventDTO, AuditMetadata, AuditMetadataValue, PersonalDataAccessEventDTO } from "./dto";

/**
 * Banco → DTO da auditoria. Funções puras, testadas em audit.test.ts.
 *
 * A metadata NÃO sai crua: cada chave precisa estar na whitelist abaixo e o
 * valor precisa ter o formato esperado para aquela chave (UUID, código,
 * número, booleano, lista de nomes de coluna). O banco já evita PII na
 * metadata (migration 014), mas há texto livre em alguns eventos (ex.:
 * `reason` da troca de origem, `cancellation_reason` do acordo) — e uma
 * regra futura do banco não pode passar a vazar dado só porque a tela mostra
 * "tudo o que veio". O que não passa é omitido e sinalizado.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface AuditEventRow {
  id: string;
  actor_type: ActorType;
  actor_user_id: string | null;
  actor_organization_id: string | null;
  agent_run_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: unknown;
  created_at: string;
}

export interface AccessEventRow {
  id: string;
  actor_type: ActorType;
  actor_user_id: string | null;
  organization_id: string | null;
  agent_run_id: string | null;
  client_id: string;
  resource_type: string;
  resource_id: string | null;
  action: string;
  purpose: string | null;
  request_id: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Whitelist da metadata                                               */
/* ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Código/estado/UUID: sem espaço, sem @, sem texto livre. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;
const COLUMN_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const NUMERIC_STRING = /^-?\d{1,15}(\.\d{1,6})?$/;

/** Chaves `*_id` (e equivalentes) — valor precisa ser UUID. */
const ID_KEY = /^[a-z][a-z0-9_]*_id$/;
const EXTRA_ID_KEYS = new Set(["decided_by", "requested_by"]);

/** Estados, vocabulários e versões (códigos curtos). `from`/`to` podem ser status ou UUID. */
export const AUDIT_TOKEN_KEYS = new Set([
  "status",
  "from",
  "to",
  "kind",
  "type",
  "role",
  "source",
  "category",
  "visibility",
  "priority",
  "operation",
  "table",
  "proposal_type",
  "applied_entity_type",
  "event_type",
  "technical_origin",
  "inactivation_reason",
  "document_type",
  "document_version",
  "provider",
  "file_type",
  "resolution",
  "error_code",
]);

/** Valores numéricos (percentuais, valores monetários, contagens, versões). */
export const AUDIT_NUMBER_KEYS = new Set([
  "version_number",
  "attempt",
  "partner_percentage",
  "owner_percentage",
  "preserved_agreements",
  "amount",
  "base_amount",
  "partner_amount",
  "owner_amount",
  "total_rows",
  "successful_rows",
  "failed_rows",
  "factors_removed",
]);

export const AUDIT_BOOLEAN_KEYS = new Set(["after_acceptance", "enabled", "active"]);

/** Lista de NOMES de colunas alteradas (nunca os valores). */
export const AUDIT_FIELD_LIST_KEYS = new Set(["fields"]);

/** Antes/depois da divisão de parceria: { partner, owner } numéricos. */
export const AUDIT_SHARE_KEYS = new Set(["before", "after"]);
const SHARE_SUBKEYS = new Set(["partner", "owner"]);

const MAX_KEYS = 40;
const MAX_FIELDS = 100;

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && NUMERIC_STRING.test(value)) return Number(value);
  return undefined;
}

/** Valor permitido para a chave, ou `undefined` (omitir). */
function sanitizeValue(key: string, value: unknown): AuditMetadataValue | undefined {
  if (ID_KEY.test(key) || EXTRA_ID_KEYS.has(key)) {
    if (value === null) return null;
    return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : undefined;
  }
  if (AUDIT_TOKEN_KEYS.has(key)) {
    if (value === null) return null;
    return typeof value === "string" && TOKEN.test(value) ? value : undefined;
  }
  if (AUDIT_NUMBER_KEYS.has(key)) return asNumber(value);
  if (AUDIT_BOOLEAN_KEYS.has(key)) return value === null || typeof value === "boolean" ? value : undefined;
  if (AUDIT_FIELD_LIST_KEYS.has(key)) {
    if (!Array.isArray(value) || value.length > MAX_FIELDS) return undefined;
    return value.every((f) => typeof f === "string" && COLUMN_NAME.test(f)) ? (value as string[]) : undefined;
  }
  if (AUDIT_SHARE_KEYS.has(key)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const out: Record<string, number | null> = {};
    for (const [sub, raw] of Object.entries(value as Record<string, unknown>)) {
      const n = SHARE_SUBKEYS.has(sub) ? asNumber(raw) : undefined;
      if (n === undefined) return undefined;
      out[sub] = n;
    }
    return out;
  }
  return undefined;
}

/** Metadata do banco → só o que está na whitelist, com formato conferido. */
export function sanitizeAuditMetadata(raw: unknown): { metadata: AuditMetadata; omitted: boolean } {
  if (raw === null || raw === undefined) return { metadata: {}, omitted: false };
  if (typeof raw !== "object" || Array.isArray(raw)) return { metadata: {}, omitted: true };
  const metadata: AuditMetadata = {};
  let omitted = false;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(metadata).length >= MAX_KEYS) {
      omitted = true;
      break;
    }
    const clean = sanitizeValue(key, value);
    if (clean === undefined) omitted = true;
    else metadata[key] = clean;
  }
  return { metadata, omitted };
}

/* ------------------------------------------------------------------ */
/* Banco → DTO                                                         */
/* ------------------------------------------------------------------ */

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function auditEventFromRow(row: AuditEventRow, actorNames: ReadonlyMap<string, string>): AuditEventDTO {
  const { metadata, omitted } = sanitizeAuditMetadata(row.metadata);
  return {
    id: row.id,
    at: row.created_at,
    actorType: row.actor_type,
    actorUserId: opt(row.actor_user_id),
    actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) : undefined,
    actorOrganizationId: opt(row.actor_organization_id),
    agentRunId: opt(row.agent_run_id),
    action: row.action,
    entityType: row.entity_type,
    entityId: opt(row.entity_id),
    requestId: opt(row.request_id),
    metadata,
    metadataOmitted: omitted,
  };
}

export function accessEventFromRow(row: AccessEventRow, actorNames: ReadonlyMap<string, string>): PersonalDataAccessEventDTO {
  return {
    id: row.id,
    at: row.created_at,
    actorType: row.actor_type,
    actorUserId: opt(row.actor_user_id),
    actorName: row.actor_user_id ? actorNames.get(row.actor_user_id) : undefined,
    organizationId: opt(row.organization_id),
    agentRunId: opt(row.agent_run_id),
    clientId: row.client_id,
    resourceType: row.resource_type,
    resourceId: opt(row.resource_id),
    action: row.action,
    purpose: opt(row.purpose),
    requestId: opt(row.request_id),
  };
}
