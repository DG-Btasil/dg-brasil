import type { Role } from "@/lib/permissions";
import { PARTNER_OFFICE_STATUS_FROM_DB, type DbOrganizationStatus } from "@/repositories/api/db-mappings";
import type { Address, ID } from "@/types";
import type {
  OabDTO,
  OrganizationUserDTO,
  OwnerOfficeDTO,
  OwnerOfficePublicDTO,
  PartnerListItem,
  PartnerOfficeAdminDTO,
  PartnerOfficeInternalDTO,
  PartnerOwnOfficeDTO,
} from "./dto";
import type { CreatePartnerInput, OabInput, OfficeAddressInput, UpdateOwnerOfficeInput, UpdatePartnerInput } from "./schemas";

/**
 * Banco (snake_case) ↔ domínio (camelCase). Funções puras, testadas em
 * organizations.test.ts. Cada função de saída monta o DTO campo a campo
 * (nunca espalha a linha do banco): o que não está listado não sai.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface OrganizationRow {
  id: string;
  type: "OWNER" | "PARTNER";
  name: string;
  legal_name: string | null;
  trade_name: string | null;
  cnpj: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_postal_code: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  address_country: string;
  status: DbOrganizationStatus;
  created_at: string;
  updated_at: string;
}

export interface PartnerSettingsRow {
  organization_id: string;
  default_partner_percentage: number | string;
  default_owner_percentage: number | string;
  partnership_active: boolean;
  responsible_name: string | null;
  responsible_oab_number: string | null;
  responsible_oab_state: string | null;
  activated_at: string | null;
  notes: string | null;
}

export interface OwnerSettingsRow {
  organization_id: string;
  principal_lawyer_name: string | null;
  principal_oab_number: string | null;
  principal_oab_state: string | null;
  states_of_practice: string[] | null;
  units: string[] | null;
}

export interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: Role;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  joined_at: string | null;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string;
  preferred_name: string | null;
  job_title: string | null;
  oab_number: string | null;
  oab_state: string | null;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const num = (v: number | string) => Number(v);

export function oabFromColumns(number: string | null | undefined, state: string | null | undefined): OabDTO | undefined {
  return number && state ? { number, state } : undefined;
}

export function addressFromOrgRow(row: OrganizationRow): Address | undefined {
  const parts = [row.address_postal_code, row.address_street, row.address_number, row.address_complement, row.address_neighborhood, row.address_city, row.address_state];
  if (parts.every((p) => p === null || p === undefined || p === "")) return undefined;
  return {
    zipCode: row.address_postal_code ?? "",
    street: row.address_street ?? "",
    number: row.address_number ?? "",
    complement: opt(row.address_complement),
    district: row.address_neighborhood ?? "",
    city: row.address_city ?? "",
    state: row.address_state ?? "",
    country: row.address_country,
  };
}

export function ownerOfficeFromRows(org: OrganizationRow, settings: OwnerSettingsRow | null): OwnerOfficeDTO {
  return {
    id: org.id,
    name: org.name,
    legalName: opt(org.legal_name),
    tradeName: opt(org.trade_name),
    cnpj: opt(org.cnpj),
    address: addressFromOrgRow(org),
    phone: opt(org.phone),
    email: opt(org.email),
    website: opt(org.website),
    principalLawyer: settings?.principal_lawyer_name ?? "",
    oab: oabFromColumns(settings?.principal_oab_number, settings?.principal_oab_state),
    statesOfPractice: settings?.states_of_practice ?? [],
    units: settings?.units ?? [],
    createdAt: org.created_at,
    updatedAt: org.updated_at,
  };
}

export function ownerOfficePublicFromRow(org: OrganizationRow): OwnerOfficePublicDTO {
  return { id: org.id, name: org.name, tradeName: opt(org.trade_name) };
}

/** Ficha do ADMIN. `ownerOrganizationId` vira `officeId` (todo parceiro pertence ao proprietário). */
export function partnerAdminFromRows(org: OrganizationRow, settings: PartnerSettingsRow | null, ownerOrganizationId: ID): PartnerOfficeAdminDTO {
  return {
    ...partnerInternalFromRow(org, ownerOrganizationId),
    responsibleName: settings?.responsible_name ?? "",
    responsibleOab: settings?.responsible_oab_number ?? "",
    oabState: settings?.responsible_oab_state ?? "",
    partnershipPercentage: settings ? num(settings.default_partner_percentage) : 0,
    ownerPercentage: settings ? num(settings.default_owner_percentage) : 0,
    partnershipActive: settings?.partnership_active ?? false,
    activatedAt: opt(settings?.activated_at),
    notes: opt(settings?.notes),
  };
}

/** Ficha da equipe interna sem acesso à parceria: só o cadastro da organização. */
export function partnerInternalFromRow(org: OrganizationRow, ownerOrganizationId: ID): PartnerOfficeInternalDTO {
  return {
    id: org.id,
    officeId: ownerOrganizationId,
    name: org.name,
    legalName: opt(org.legal_name),
    tradeName: opt(org.trade_name),
    cnpj: opt(org.cnpj),
    email: org.email ?? "",
    phone: org.phone ?? "",
    website: opt(org.website),
    address: addressFromOrgRow(org),
    status: PARTNER_OFFICE_STATUS_FROM_DB[org.status],
    createdAt: org.created_at,
    updatedAt: org.updated_at,
  };
}

/** O próprio escritório no Portal do Parceiro. Não recebe (nem tem onde pôr) dado da parceria. */
export function partnerOwnOfficeFromRow(org: OrganizationRow): PartnerOwnOfficeDTO {
  return {
    id: org.id,
    name: org.name,
    legalName: opt(org.legal_name),
    tradeName: opt(org.trade_name),
    cnpj: opt(org.cnpj),
    email: opt(org.email),
    phone: opt(org.phone),
    website: opt(org.website),
    address: addressFromOrgRow(org),
    status: PARTNER_OFFICE_STATUS_FROM_DB[org.status],
    createdAt: org.created_at,
  };
}

export function partnerListItemFromRow(org: OrganizationRow, settings: PartnerSettingsRow | null | undefined): PartnerListItem {
  return {
    id: org.id,
    name: org.name,
    tradeName: opt(org.trade_name),
    cnpj: opt(org.cnpj),
    email: opt(org.email),
    status: PARTNER_OFFICE_STATUS_FROM_DB[org.status],
    share: settings
      ? {
          partnershipPercentage: num(settings.default_partner_percentage),
          ownerPercentage: num(settings.default_owner_percentage),
          partnershipActive: settings.partnership_active,
        }
      : undefined,
    createdAt: org.created_at,
    updatedAt: org.updated_at,
  };
}

export function organizationUserFromRows(m: MembershipRow, profile: ProfileRow | undefined): OrganizationUserDTO {
  const name = profile?.full_name ?? "";
  return {
    membershipId: m.id,
    userId: m.user_id,
    organizationId: m.organization_id,
    name,
    displayName: profile?.preferred_name || name,
    jobTitle: opt(profile?.job_title),
    oab: oabFromColumns(profile?.oab_number, profile?.oab_state),
    role: m.role,
    membershipStatus: m.status,
    active: profile?.active ?? false,
    joinedAt: opt(m.joined_at),
  };
}

/* ------------------------------------------------------------------ */
/* Domínio → payloads de gravação (PATCH: só chaves presentes)         */
/* ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

/** Endereço → colunas address_*. `null` limpa tudo (o país volta para BR). */
export function addressColumns(address: OfficeAddressInput | null | undefined): Json {
  return {
    address_postal_code: address?.zipCode ?? null,
    address_street: address?.street ?? null,
    address_number: address?.number ?? null,
    address_complement: address?.complement ?? null,
    address_neighborhood: address?.district ?? null,
    address_city: address?.city ?? null,
    address_state: address?.state ?? null,
    address_country: address?.country ?? "BR",
  };
}

function oabColumns(prefix: "responsible_oab" | "principal_oab", oab: OabInput | null | undefined): Json {
  return { [`${prefix}_number`]: oab?.number ?? null, [`${prefix}_state`]: oab?.state ?? null };
}

const ORG_FIELDS: Record<string, string> = {
  name: "name",
  legalName: "legal_name",
  tradeName: "trade_name",
  cnpj: "cnpj",
  email: "email",
  phone: "phone",
  website: "website",
};

/** Colunas de `organizations` presentes no patch. Nunca `type`, `status` nem `deleted_at`. */
export function organizationPatchPayload(patch: Record<string, unknown>): Json {
  const out: Json = {};
  for (const [field, column] of Object.entries(ORG_FIELDS)) {
    if (!(field in patch)) continue;
    // Nome é obrigatório no banco: ausente/indefinido não vira "apagar".
    if (field === "name" && patch[field] == null) continue;
    out[column] = patch[field] ?? null;
  }
  if ("address" in patch) Object.assign(out, addressColumns(patch.address as OfficeAddressInput | null | undefined));
  return out;
}

/** Linha nova de `organizations`: sempre PARTNER, sempre PENDING (convite pendente). */
export function newPartnerOrganizationPayload(id: string, input: CreatePartnerInput): Json {
  return {
    id,
    type: "PARTNER",
    status: "PENDING",
    name: input.name,
    legal_name: input.legalName ?? null,
    trade_name: input.tradeName ?? null,
    cnpj: input.cnpj ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    ...addressColumns(input.address),
  };
}

export function newPartnerSettingsPayload(organizationId: string, input: CreatePartnerInput): Json {
  return {
    organization_id: organizationId,
    default_partner_percentage: input.partnershipPercentage,
    default_owner_percentage: input.ownerPercentage,
    partnership_active: input.partnershipActive,
    responsible_name: input.responsibleName ?? null,
    ...oabColumns("responsible_oab", input.responsibleOab),
    notes: input.notes ?? null,
  };
}

/** Colunas de `partner_office_settings` presentes no patch. NUNCA os percentuais (operação própria). */
export function partnerSettingsPatchPayload(patch: UpdatePartnerInput["patch"]): Json {
  const out: Json = {};
  if ("responsibleName" in patch) out.responsible_name = patch.responsibleName ?? null;
  if ("responsibleOab" in patch) Object.assign(out, oabColumns("responsible_oab", patch.responsibleOab));
  if ("notes" in patch) out.notes = patch.notes ?? null;
  if ("partnershipActive" in patch && patch.partnershipActive !== undefined) out.partnership_active = patch.partnershipActive;
  return out;
}

export function sharePayload(partnershipPercentage: number, ownerPercentage: number): Json {
  return { default_partner_percentage: partnershipPercentage, default_owner_percentage: ownerPercentage };
}

/** Colunas de `owner_office_settings` presentes no patch. */
export function ownerSettingsPatchPayload(patch: UpdateOwnerOfficeInput): Json {
  const out: Json = {};
  if ("principalLawyer" in patch) out.principal_lawyer_name = patch.principalLawyer ?? null;
  if ("oab" in patch) Object.assign(out, oabColumns("principal_oab", patch.oab));
  if ("statesOfPractice" in patch && patch.statesOfPractice) out.states_of_practice = patch.statesOfPractice;
  if ("units" in patch && patch.units) out.units = patch.units;
  return out;
}
