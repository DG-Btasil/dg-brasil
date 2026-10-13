import type { LegalArea } from "@/lib/constants/legal";
import type { LegalCaseStatus } from "@/lib/constants/status";
import type { ID } from "@/types";
import type { CaseInternalDTO, CaseListItem, CasePartnerDTO } from "./dto";
import type { CreateCaseInput, PartnerSubmitCaseInput, UpdateCasePatch } from "./schemas";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * cases.test.ts. Componentes React nunca veem nome de coluna.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

interface CatalogRef {
  code: string;
  name: string;
}

/** Colunas que o parceiro também recebe. */
export interface CasePartnerRow {
  id: string;
  client_id: string;
  legal_area_id: string;
  case_type_id: string | null;
  title: string;
  summary: string | null;
  opposing_party: string | null;
  status: LegalCaseStatus;
  partner_organization_id: string | null;
  origin_organization_id: string;
  partner_notes: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  closed_at: string | null;
  archived_at: string | null;
  rejection_reason_public: string | null;
  created_at: string;
  updated_at: string;
  legal_areas: CatalogRef | CatalogRef[] | null;
  case_types: CatalogRef | CatalogRef[] | null;
}

/** Ficha interna: + autoria e advogado responsável. */
export interface CaseRow extends CasePartnerRow {
  created_by_organization_id: string;
  created_by: string | null;
  assigned_lawyer_id: string | null;
}

/** legal_case_internal_details (nunca lida para parceiro). */
export interface CaseInternalRow {
  rejection_reason_internal: string | null;
  internal_notes: string | null;
  accepted_by: string | null;
}

interface ClientNameRef {
  individual_client_details: { full_name: string } | { full_name: string }[] | null;
  company_client_details: { legal_name: string } | { legal_name: string }[] | null;
}

export interface CaseListRow {
  id: string;
  client_id: string;
  legal_area_id: string;
  case_type_id: string | null;
  title: string;
  status: LegalCaseStatus;
  origin_organization_id: string;
  partner_organization_id: string | null;
  /** Ausente na consulta do parceiro. */
  assigned_lawyer_id?: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
  legal_areas: CatalogRef | CatalogRef[] | null;
  case_types: CatalogRef | CatalogRef[] | null;
  clients: ClientNameRef | ClientNameRef[] | null;
}

/** Estado mínimo para decisões do service (existência, status, vínculos). */
export interface CaseStateRow {
  id: string;
  status: LegalCaseStatus;
  legal_area_id: string;
  partner_organization_id: string | null;
  origin_organization_id: string;
  accepted_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

function clientName(ref: CaseListRow["clients"]): string {
  const c = one(ref);
  if (!c) return "";
  return one(c.individual_client_details)?.full_name ?? one(c.company_client_details)?.legal_name ?? "";
}

export function listItemFromRow(row: CaseListRow, viewer: { surface: "INTERNAL" | "PARTNER" }): CaseListItem {
  const internal = viewer.surface === "INTERNAL";
  const area = one(row.legal_areas);
  const type = one(row.case_types);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: clientName(row.clients),
    title: row.title,
    area: area?.code ?? "",
    legalAreaId: row.legal_area_id,
    caseTypeId: opt(row.case_type_id),
    caseTypeName: type?.name,
    status: row.status,
    originOrganizationId: row.origin_organization_id,
    partnerOrganizationId: row.partner_organization_id,
    assignedLawyerId: internal ? opt(row.assigned_lawyer_id) : undefined,
    submittedAt: opt(row.submitted_at),
    acceptedAt: opt(row.accepted_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ficha interna = `LegalCase` do front (+ ids do catálogo). `ownerOrganizationId` vira `officeId`. */
export function internalCaseFromRows(row: CaseRow, internalRow: CaseInternalRow | null, ownerOrganizationId: ID): CaseInternalDTO {
  const area = one(row.legal_areas);
  const type = one(row.case_types);
  return {
    id: row.id,
    officeId: ownerOrganizationId,
    clientId: row.client_id,
    title: row.title,
    // O catálogo é extensível (novas áreas são linhas); o front conhece as do seed.
    area: (area?.code ?? "") as LegalArea,
    areaName: area?.name ?? "",
    legalAreaId: row.legal_area_id,
    caseType: type?.name ?? "",
    caseTypeId: opt(row.case_type_id),
    caseTypeCode: type?.code,
    originOrganizationId: row.origin_organization_id,
    createdByOrganizationId: row.created_by_organization_id,
    partnerOrganizationId: row.partner_organization_id,
    createdBy: row.created_by ?? "",
    assignedLawyerId: row.assigned_lawyer_id,
    summary: row.summary ?? "",
    opposingParty: opt(row.opposing_party),
    status: row.status,
    submittedAt: opt(row.submitted_at),
    acceptedAt: opt(row.accepted_at),
    acceptedBy: opt(internalRow?.accepted_by),
    rejectedAt: opt(row.rejected_at),
    rejectionReasonPublic: opt(row.rejection_reason_public),
    rejectionReasonInternal: opt(internalRow?.rejection_reason_internal),
    closedAt: opt(row.closed_at),
    archivedAt: opt(row.archived_at),
    notes: opt(internalRow?.internal_notes),
    partnerNotes: opt(row.partner_notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Ficha do parceiro: campo a campo, explicitamente. Mesmo que a linha traga
 * colunas a mais, nada interno é copiado.
 */
export function partnerCaseFromRow(row: CasePartnerRow, partnerOrganizationId: ID): CasePartnerDTO {
  const area = one(row.legal_areas);
  const type = one(row.case_types);
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    area: area?.code ?? "",
    areaName: area?.name ?? "",
    legalAreaId: row.legal_area_id,
    caseTypeId: opt(row.case_type_id),
    caseTypeCode: type?.code,
    caseType: type?.name ?? "",
    summary: row.summary ?? "",
    opposingParty: opt(row.opposing_party),
    status: row.status,
    originOrganizationId: row.origin_organization_id,
    // A RLS só entrega casos do próprio escritório; a sessão é a fonte.
    partnerOrganizationId,
    partnerNotes: opt(row.partner_notes),
    submittedAt: opt(row.submitted_at),
    acceptedAt: opt(row.accepted_at),
    rejectedAt: opt(row.rejected_at),
    rejectionReasonPublic: opt(row.rejection_reason_public),
    closedAt: opt(row.closed_at),
    archivedAt: opt(row.archived_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Domínio → colunas de legal_cases                                    */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

/** Inserção interna. Autoria, datas de estado e relacionamento: triggers do banco. */
export function createPayload(
  input: CreateCaseInput,
  resolved: { id: ID; legalAreaId: ID; caseTypeId: ID | null; partnerOrganizationId: ID | null },
): Json {
  return {
    id: resolved.id,
    client_id: input.clientId,
    legal_area_id: resolved.legalAreaId,
    case_type_id: resolved.caseTypeId,
    title: input.title,
    summary: input.summary ?? null,
    opposing_party: input.opposingParty ?? null,
    status: input.submit ? "SUBMITTED" : "DRAFT",
    origin_organization_id: input.originOrganizationId,
    partner_organization_id: resolved.partnerOrganizationId,
    assigned_lawyer_id: input.assignedLawyerId ?? null,
    partner_notes: input.partnerNotes ?? null,
  };
}

const PATCH_TO_COLUMN = {
  title: "title",
  summary: "summary",
  opposingParty: "opposing_party",
  partnerNotes: "partner_notes",
} as const;

/**
 * PATCH de legal_cases: só chaves presentes; `null`/vazio limpa. Área e tipo
 * chegam já resolvidos (`catalog`); `notes` (interno) NÃO entra aqui.
 */
export function updatePayload(patch: UpdateCasePatch, catalog?: { legalAreaId?: ID; caseTypeId?: ID | null }): Json {
  const out: Json = {};
  for (const [field, column] of Object.entries(PATCH_TO_COLUMN)) {
    if (field in patch) out[column] = (patch as Record<string, unknown>)[field] ?? null;
  }
  if (catalog?.legalAreaId !== undefined) out.legal_area_id = catalog.legalAreaId;
  if (catalog && catalog.caseTypeId !== undefined) out.case_type_id = catalog.caseTypeId;
  return out;
}

/* ------------------------------------------------------------------ */
/* Domínio → payload de partner_submit_case (025)                      */
/* ------------------------------------------------------------------ */

export function partnerSubmitPayload(
  input: PartnerSubmitCaseInput,
  resolved: { clientOriginId: ID; caseOriginId: ID; legalAreaId: ID; caseTypeId: ID | null },
): { p_client: Json; p_case: Json } {
  const c = input.client;
  const a = c.address;
  const p_client: Json = {
    document: c.document,
    kind: c.kind,
    origin_organization_id: resolved.clientOriginId,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address: a
      ? {
          postal_code: a.zipCode ?? null,
          street: a.street ?? null,
          number: a.number ?? null,
          complement: a.complement ?? null,
          neighborhood: a.district ?? null,
          city: a.city ?? null,
          state: a.state ?? null,
        }
      : null,
  };
  if (c.kind === "INDIVIDUAL") {
    p_client.full_name = c.fullName ?? null;
    p_client.birth_date = c.birthDate ?? null;
  } else {
    p_client.legal_name = c.legalName ?? null;
    p_client.trade_name = c.tradeName ?? null;
  }
  const p_case: Json = {
    legal_area_id: resolved.legalAreaId,
    case_type_id: resolved.caseTypeId,
    title: input.case.title,
    summary: input.case.summary ?? null,
    opposing_party: input.case.opposingParty ?? null,
    origin_organization_id: resolved.caseOriginId,
    partner_notes: input.case.partnerNotes ?? null,
  };
  return { p_client, p_case };
}
