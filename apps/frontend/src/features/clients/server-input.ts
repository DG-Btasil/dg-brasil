import { onlyDigits } from "@/lib/formatting";
import type { Client } from "@/types";
import type { AddressFormValues, CompanyFormValues, IndividualFormValues } from "./schemas";

/**
 * Formulário (strings) → entrada das Server Actions de cliente.
 *
 * O servidor valida tudo de novo (schemas Zod em server/domain/clients); aqui
 * só se traduz o formato da tela: vazio vira ausente onde o servidor exige um
 * formato (data, UF, CEP, enum) e texto vazio é mantido onde ele significa
 * "apagar" na edição (o servidor converte em null). IDs são do banco: nada de
 * id gerado no navegador.
 */

type Json = Record<string, unknown>;

/** Texto preenchido ou ausente. */
const filled = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/** País: o banco guarda o código ISO de 2 letras ("Brasil" → "BR"). */
export function countryCode(country: string | undefined): string | undefined {
  const c = (country ?? "").trim();
  if (!c || /^brasil$/i.test(c)) return "BR";
  return /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : undefined;
}

export function hasAddress(a: AddressFormValues): boolean {
  return [a.zipCode, a.street, a.number, a.district, a.city, a.state].some((v) => v && v.trim());
}

export function addressToServer(a: AddressFormValues): Json | undefined {
  if (!hasAddress(a)) return undefined;
  return {
    zipCode: filled(a.zipCode),
    street: a.street.trim(),
    number: a.number.trim(),
    complement: a.complement.trim(),
    district: a.district.trim(),
    city: a.city.trim(),
    state: filled(a.state),
    country: countryCode(a.country),
  };
}

function identityDocument(v: IndividualFormValues): Json | undefined {
  if (!v.idType || !v.idNumber.trim()) return undefined;
  return { type: v.idType, number: v.idNumber.trim(), issuer: v.idIssuer.trim(), state: filled(v.idState) };
}

function stableUnion(v: IndividualFormValues): boolean | undefined {
  return v.maritalStatus === "MARRIED" || !v.stableUnion ? undefined : v.stableUnion === "yes";
}

const cnae = (v: string) => onlyDigits(v);
const secondaryCnaes = (v: string) => v.split(/\n|;|,/).map(cnae).filter(Boolean);

function sharePercent(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/* ------------------------------------------------------------------ */
/* Cadastro                                                            */
/* ------------------------------------------------------------------ */

export function individualCreateInput(v: IndividualFormValues): Json {
  return {
    kind: "INDIVIDUAL",
    cpf: v.cpf,
    fullName: v.fullName,
    socialName: v.socialName,
    birthDate: filled(v.birthDate),
    gender: filled(v.gender),
    nationality: v.nationality,
    birthplace: v.birthplace,
    maritalStatus: filled(v.maritalStatus),
    stableUnion: stableUnion(v),
    profession: v.profession,
    identityDocument: identityDocument(v),
    originOfficeId: v.originOfficeId,
    responsibleUserId: filled(v.responsibleUserId),
    contact: { email: v.email, phone: v.phone, secondaryPhone: v.secondaryPhone },
    address: addressToServer(v.address),
    notes: v.notes,
    legalSummary: v.legalSummary,
  };
}

export function companyCreateInput(v: CompanyFormValues): Json {
  return {
    kind: "COMPANY",
    cnpj: v.cnpj,
    legalName: v.legalName,
    tradeName: v.tradeName,
    registrationStatus: v.registrationStatus,
    openingDate: filled(v.openingDate),
    legalNature: v.legalNature,
    mainCnae: filled(cnae(v.mainCnae)),
    secondaryCnaes: secondaryCnaes(v.secondaryCnaes),
    originOfficeId: v.originOfficeId,
    responsibleUserId: filled(v.responsibleUserId),
    contact: { email: v.email, phone: v.phone, website: v.website },
    address: addressToServer(v.address),
    notes: v.notes,
    legalSummary: v.legalSummary,
    representatives: v.representatives.map((r) => ({
      name: r.name,
      cpf: filled(r.cpf),
      role: r.role,
      email: r.email,
      phone: r.phone,
      isPrimary: r.isPrimary,
    })),
    partners: v.partners
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name, document: p.document, qualification: p.qualification, sharePercent: sharePercent(p.sharePercent) })),
  };
}

/* ------------------------------------------------------------------ */
/* Edição (PATCH)                                                      */
/* ------------------------------------------------------------------ */

/**
 * Mudou o CPF/CNPJ? Só então o documento vai no PATCH — corrigir documento é
 * decisão de ADMIN e o servidor recusa para os demais papéis.
 */
function documentChange(next: string, original: Client): string | undefined {
  const current = original.kind === "INDIVIDUAL" ? original.cpf : original.cnpj;
  return onlyDigits(next) !== onlyDigits(current) ? next : undefined;
}

export function documentChanged(next: string, original: Client): boolean {
  return documentChange(next, original) !== undefined;
}

/**
 * Campos com formato (data, gênero, estado civil, documento de identidade)
 * só vão quando preenchidos: o PATCH não os apaga. Textos e contatos vazios
 * vão vazios e o servidor apaga.
 */
export function individualPatch(v: IndividualFormValues, original: Client): Json {
  const patch: Json = {
    fullName: v.fullName,
    socialName: v.socialName,
    nationality: v.nationality,
    birthplace: v.birthplace,
    profession: v.profession,
    originOfficeId: v.originOfficeId,
    responsibleUserId: filled(v.responsibleUserId) ?? null,
    contact: { email: v.email, phone: v.phone, secondaryPhone: v.secondaryPhone },
    address: addressToServer(v.address) ?? null,
    notes: v.notes,
    legalSummary: v.legalSummary,
  };
  const optional: Json = {
    birthDate: filled(v.birthDate),
    gender: filled(v.gender),
    maritalStatus: filled(v.maritalStatus),
    stableUnion: stableUnion(v),
    identityDocument: identityDocument(v),
    document: documentChange(v.cpf, original),
  };
  for (const [k, value] of Object.entries(optional)) if (value !== undefined) patch[k] = value;
  return patch;
}

/** Representantes e sócios não vão no PATCH: o banco só os grava no cadastro. */
export function companyPatch(v: CompanyFormValues, original: Client): Json {
  const patch: Json = {
    legalName: v.legalName,
    tradeName: v.tradeName,
    registrationStatus: v.registrationStatus,
    legalNature: v.legalNature,
    secondaryCnaes: secondaryCnaes(v.secondaryCnaes),
    originOfficeId: v.originOfficeId,
    responsibleUserId: filled(v.responsibleUserId) ?? null,
    contact: { email: v.email, phone: v.phone, website: v.website },
    address: addressToServer(v.address) ?? null,
    notes: v.notes,
    legalSummary: v.legalSummary,
  };
  const optional: Json = {
    openingDate: filled(v.openingDate),
    mainCnae: filled(cnae(v.mainCnae)),
    document: documentChange(v.cnpj, original),
  };
  for (const [k, value] of Object.entries(optional)) if (value !== undefined) patch[k] = value;
  return patch;
}

/* ------------------------------------------------------------------ */
/* Erros de campo do servidor → nomes do formulário                     */
/* ------------------------------------------------------------------ */

/** Caminhos do schema da action que diferem dos nomes do formulário. */
export const CLIENT_FIELD_MAP: Record<string, string> = {
  document: "cpf",
  "contact.email": "email",
  "contact.phone": "phone",
  "contact.secondaryPhone": "secondaryPhone",
  "contact.website": "website",
  "address.zipCode": "address.zipCode",
  "address.state": "address.state",
  "identityDocument.*": "idNumber",
};

export const COMPANY_FIELD_MAP: Record<string, string> = { ...CLIENT_FIELD_MAP, document: "cnpj" };
