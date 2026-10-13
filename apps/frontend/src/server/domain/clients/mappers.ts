import { CLIENT_STATUS_FROM_DB, type DbClientStatus } from "@/repositories/api/db-mappings";
import type { Address, Client, ClientInactivationReason, Contact, ID } from "@/types";
import type { CreateClientInput, ReplaceCompanyPeopleInput, UpdateClientInput, UpdateClientBasicsInput } from "./schemas";
import type { ClientListItem, ClientPartnerDTO, ClientRelationshipDTO } from "./dto";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * mappers.test.ts. Componentes React nunca veem nome de coluna.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface ClientDirectoryRow {
  id: string;
  kind: "INDIVIDUAL" | "COMPANY";
  display_name: string | null;
  trade_name: string | null;
  cpf: string | null;
  cnpj: string | null;
  status: DbClientStatus;
  origin_organization_id: string;
  responsible_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactRow {
  type: "EMAIL" | "PHONE" | "WHATSAPP" | "WEBSITE" | "OTHER";
  value: string;
  is_primary: boolean;
}
interface AddressRow {
  postal_code: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  country: string;
  is_primary: boolean;
}

export interface ClientDetailRow {
  id: string;
  kind: "INDIVIDUAL" | "COMPANY";
  cpf: string | null;
  cnpj: string | null;
  status: DbClientStatus;
  origin_organization_id: string;
  responsible_user_id: string | null;
  created_at: string;
  updated_at: string;
  individual_client_details: IndividualRow | IndividualRow[] | null;
  company_client_details: CompanyRow | CompanyRow[] | null;
  client_contacts: ContactRow[] | null;
  client_addresses: AddressRow[] | null;
  company_representatives?: RepresentativeRow[] | null;
  company_shareholders?: ShareholderRow[] | null;
}
interface IndividualRow {
  full_name: string;
  social_name: string | null;
  birth_date: string | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  nationality: string | null;
  birthplace: string | null;
  marital_status: "SINGLE" | "MARRIED" | "DIVORCED" | "WIDOWED" | "SEPARATED" | null;
  stable_union: boolean | null;
  profession: string | null;
  identity_document_type: "RG" | "CNH" | "PASSPORT" | "RNM" | "OTHER" | null;
  identity_document_number: string | null;
  identity_document_issuer: string | null;
  identity_document_state: string | null;
}
interface CompanyRow {
  legal_name: string;
  trade_name: string | null;
  registration_status: string | null;
  opening_date: string | null;
  legal_nature: string | null;
  main_cnae: string | null;
  secondary_cnaes: string[] | null;
}
interface RepresentativeRow {
  id: string;
  full_name: string;
  cpf: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  primary_representative: boolean;
}
interface ShareholderRow {
  id: string;
  name: string;
  document_number: string | null;
  qualification: string | null;
  share_percentage: number | string | null;
}

export interface ClientInternalRow {
  notes: string | null;
  legal_summary: string | null;
  inactivation_reason: ClientInactivationReason | null;
  inactivation_note: string | null;
  inactivated_at: string | null;
  inactivated_by: string | null;
}

export interface RelationshipRow {
  organization_id: string;
  status: "ACTIVE" | "ENDED";
  created_at: string;
  ended_at: string | null;
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function contactFromRows(rows: ContactRow[] | null | undefined): Contact {
  const list = rows ?? [];
  const pick = (type: ContactRow["type"], primary: boolean) => list.find((c) => c.type === type && c.is_primary === primary)?.value;
  return {
    email: pick("EMAIL", true),
    phone: pick("PHONE", true),
    secondaryPhone: pick("PHONE", false),
    website: pick("WEBSITE", true),
  };
}

export function addressFromRows(rows: AddressRow[] | null | undefined): Address | undefined {
  const a = (rows ?? []).find((r) => r.is_primary);
  if (!a) return undefined;
  return {
    zipCode: a.postal_code ?? "",
    street: a.street ?? "",
    number: a.number ?? "",
    complement: opt(a.complement),
    district: a.neighborhood ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    country: a.country,
  };
}

export function listItemFromRow(row: ClientDirectoryRow, viewer: { surface: "INTERNAL" | "PARTNER"; organizationId: ID }): ClientListItem {
  const internal = viewer.surface === "INTERNAL";
  return {
    id: row.id,
    kind: row.kind,
    name: row.display_name ?? "",
    tradeName: opt(row.trade_name),
    document: row.cpf ?? row.cnpj ?? "",
    status: CLIENT_STATUS_FROM_DB[row.status],
    originOrganizationId: internal || row.origin_organization_id === viewer.organizationId ? row.origin_organization_id : undefined,
    responsibleUserId: internal ? opt(row.responsible_user_id) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Ficha interna = `Client` do domínio do front. `ownerOrganizationId` vira `officeId`. */
export function internalClientFromRows(row: ClientDetailRow, internalRow: ClientInternalRow | null, ownerOrganizationId: ID): Client {
  const base = {
    id: row.id,
    officeId: ownerOrganizationId,
    status: CLIENT_STATUS_FROM_DB[row.status],
    responsibleUserId: row.responsible_user_id ?? "",
    contact: contactFromRows(row.client_contacts),
    address: addressFromRows(row.client_addresses),
    notes: opt(internalRow?.notes),
    legalSummary: opt(internalRow?.legal_summary),
    inactivation:
      internalRow?.inactivated_at && internalRow.inactivated_by
        ? {
            reason: opt(internalRow.inactivation_reason),
            note: opt(internalRow.inactivation_note),
            at: internalRow.inactivated_at,
            by: internalRow.inactivated_by,
            previousStatus: "ACTIVE" as const,
          }
        : undefined,
    originOfficeId: row.origin_organization_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.kind === "INDIVIDUAL") {
    const d = one(row.individual_client_details);
    return {
      ...base,
      kind: "INDIVIDUAL",
      fullName: d?.full_name ?? "",
      socialName: opt(d?.social_name),
      cpf: row.cpf ?? "",
      identityDocument:
        d?.identity_document_type && d.identity_document_number
          ? { type: d.identity_document_type, number: d.identity_document_number, issuer: opt(d.identity_document_issuer), state: opt(d.identity_document_state) }
          : undefined,
      birthDate: opt(d?.birth_date),
      nationality: opt(d?.nationality),
      birthplace: opt(d?.birthplace),
      gender: opt(d?.gender),
      maritalStatus: opt(d?.marital_status),
      stableUnion: opt(d?.stable_union),
      profession: opt(d?.profession),
    };
  }
  const d = one(row.company_client_details);
  return {
    ...base,
    kind: "COMPANY",
    legalName: d?.legal_name ?? "",
    tradeName: opt(d?.trade_name),
    cnpj: row.cnpj ?? "",
    registrationStatus: opt(d?.registration_status),
    openingDate: opt(d?.opening_date),
    legalNature: opt(d?.legal_nature),
    mainCnae: opt(d?.main_cnae),
    secondaryCnaes: d?.secondary_cnaes ?? [],
    representatives: (row.company_representatives ?? []).map((r) => ({
      id: r.id,
      name: r.full_name,
      cpf: r.cpf ?? "",
      role: r.role_title ?? "",
      email: opt(r.email),
      phone: opt(r.phone),
      isPrimary: r.primary_representative,
    })),
    partners: (row.company_shareholders ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      document: s.document_number ?? "",
      qualification: s.qualification ?? "",
      sharePercent: s.share_percentage === null ? undefined : Number(s.share_percentage),
    })),
  };
}

/** Ficha do parceiro: só cadastro básico. Não recebe (nem tem onde pôr) dado interno. */
export function partnerClientFromRow(row: ClientDetailRow, partnerOrganizationId: ID): ClientPartnerDTO {
  const base = {
    id: row.id,
    status: CLIENT_STATUS_FROM_DB[row.status],
    contact: contactFromRows(row.client_contacts),
    address: addressFromRows(row.client_addresses),
    originOfficeId: row.origin_organization_id === partnerOrganizationId ? row.origin_organization_id : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.kind === "INDIVIDUAL") {
    const d = one(row.individual_client_details);
    return { ...base, kind: "INDIVIDUAL", fullName: d?.full_name ?? "", socialName: opt(d?.social_name), cpf: row.cpf ?? "", birthDate: opt(d?.birth_date) };
  }
  const d = one(row.company_client_details);
  return { ...base, kind: "COMPANY", legalName: d?.legal_name ?? "", tradeName: opt(d?.trade_name), cnpj: row.cnpj ?? "" };
}

export function relationshipFromRow(row: RelationshipRow): ClientRelationshipDTO {
  return { organizationId: row.organization_id, status: row.status, createdAt: row.created_at, endedAt: opt(row.ended_at) };
}

/* ------------------------------------------------------------------ */
/* Domínio → payload de private.save_client (PATCH: só chaves presentes) */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function contactPayload(contact: CreateClientInput["contact"] | undefined): Json | undefined {
  if (!contact) return undefined;
  const out: Json = {};
  if ("email" in contact) out.email = contact.email ?? null;
  if ("phone" in contact) out.phone = contact.phone ?? null;
  if ("secondaryPhone" in contact) out.secondary_phone = contact.secondaryPhone ?? null;
  if ("website" in contact) out.website = contact.website ?? null;
  return out;
}

function addressPayload(address: CreateClientInput["address"] | null): Json | null {
  if (!address) return null;
  return {
    postal_code: address.zipCode ?? null,
    street: address.street ?? null,
    number: address.number ?? null,
    complement: address.complement ?? null,
    neighborhood: address.district ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    country: address.country ?? "BR",
  };
}

const FIELD_TO_COLUMN: Record<string, string> = {
  fullName: "full_name",
  socialName: "social_name",
  birthDate: "birth_date",
  gender: "gender",
  nationality: "nationality",
  birthplace: "birthplace",
  maritalStatus: "marital_status",
  stableUnion: "stable_union",
  profession: "profession",
  legalName: "legal_name",
  tradeName: "trade_name",
  registrationStatus: "registration_status",
  openingDate: "opening_date",
  legalNature: "legal_nature",
  mainCnae: "main_cnae",
  secondaryCnaes: "secondary_cnaes",
  originOfficeId: "origin_organization_id",
  responsibleUserId: "responsible_user_id",
  notes: "notes",
  legalSummary: "legal_summary",
  document: "document",
};

function copyFields(source: Record<string, unknown>, out: Json) {
  for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
    if (field in source) out[column] = source[field] ?? null;
  }
  if ("identityDocument" in source) {
    const id = source.identityDocument as { type: string; number: string; issuer?: string; state?: string } | null | undefined;
    out.identity_document = id ? { type: id.type, number: id.number, issuer: id.issuer ?? null, state: id.state ?? null } : null;
  }
}

export function createPayload(input: CreateClientInput): Json {
  const out: Json = { kind: input.kind, document: input.kind === "INDIVIDUAL" ? input.cpf : input.cnpj };
  copyFields(input as unknown as Record<string, unknown>, out);
  out.contact = contactPayload(input.contact) ?? {};
  if (input.address) out.address = addressPayload(input.address);
  if (input.kind === "COMPANY") {
    out.representatives = input.representatives.map((r) => ({ name: r.name, cpf: r.cpf ?? null, role: r.role ?? null, email: r.email ?? null, phone: r.phone ?? null, is_primary: r.isPrimary }));
    out.shareholders = input.partners.map((s) => ({ name: s.name, document: s.document ?? null, qualification: s.qualification ?? null, share_percentage: s.sharePercent ?? null }));
  }
  return out;
}

export function updatePayload(patch: UpdateClientInput["patch"]): Json {
  const out: Json = {};
  copyFields(patch as Record<string, unknown>, out);
  if ("contact" in patch) out.contact = contactPayload(patch.contact) ?? {};
  if ("address" in patch) out.address = addressPayload(patch.address ?? null);
  return out;
}

/** Bloco societário (028): listas no vocabulário de private.replace_company_people. */
export function companyPeoplePayload(input: Pick<ReplaceCompanyPeopleInput, "representatives" | "partners">): { representatives: Json[]; shareholders: Json[] } {
  return {
    representatives: input.representatives.map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: r.name,
      cpf: r.cpf ?? null,
      role: r.role ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
      is_primary: r.isPrimary,
    })),
    shareholders: input.partners.map((s) => ({
      ...(s.id ? { id: s.id } : {}),
      name: s.name,
      document: s.document || null,
      qualification: s.qualification ?? null,
      share_percentage: s.sharePercent ?? null,
    })),
  };
}

/** Parceiro: o payload só PODE ter contato e endereço (o banco recusa o resto). */
export function basicsPayload(input: UpdateClientBasicsInput): Json {
  const out: Json = {};
  if (input.contact) out.contact = contactPayload(input.contact) ?? {};
  if (input.address !== undefined) out.address = addressPayload(input.address);
  return out;
}
