import type { ClientPole } from "@/lib/constants/status";
import { parseCurrencyInput } from "@/lib/validation";

/**
 * Formulários do Portal do Parceiro (strings) → entrada das Server Actions.
 * Puro: o servidor valida tudo de novo. O escritório do parceiro NUNCA vai
 * daqui — a origem é "OWN_OFFICE" ou "OWNER" e o id sai da sessão/banco.
 */

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

/* ------------------------------------------------------------------ */
/* Processo                                                            */
/* ------------------------------------------------------------------ */

export interface PartnerProcessValues {
  cnj: string;
  title: string;
  court: string;
  unit: string;
  district: string;
  state: string;
  actionType: string;
  subject: string;
  clientPole: ClientPole;
  opposingParty: string;
  distributionDate: string;
  caseValue: string;
}

/** createPartnerProcessAction (sem a chave de idempotência). */
export function partnerProcessInput(legalCaseId: string, v: PartnerProcessValues): Record<string, unknown> {
  return {
    legalCaseId,
    title: v.title.trim(),
    cnj: blank(v.cnj),
    court: blank(v.court),
    unit: blank(v.unit),
    district: blank(v.district),
    state: blank(v.state),
    actionType: blank(v.actionType),
    subject: blank(v.subject),
    clientPole: v.clientPole,
    opposingParty: blank(v.opposingParty),
    distributionDate: blank(v.distributionDate),
    caseValue: parseCurrencyInput(v.caseValue),
  };
}

/* ------------------------------------------------------------------ */
/* Envio de caso                                                       */
/* ------------------------------------------------------------------ */

export type PartnerOrigin = "OWN_OFFICE" | "OWNER";

/** Opção de origem escolhida na tela (id do diretório) → origem aceita pelo servidor. */
export function partnerOrigin(originId: string, ownerId: string): PartnerOrigin {
  return originId && originId === ownerId ? "OWNER" : "OWN_OFFICE";
}

export interface PartnerCaseValues {
  kind: "INDIVIDUAL" | "COMPANY";
  clientOriginId: string;
  document: string;
  fullName: string;
  birthDate: string;
  legalName: string;
  tradeName: string;
  email: string;
  phone: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  title: string;
  area: string;
  caseTypeId: string;
  caseOriginId: string;
  opposingParty: string;
  summary: string;
  notes: string;
}

function address(v: PartnerCaseValues) {
  if (![v.zipCode, v.street, v.number, v.district, v.city, v.state].some((x) => x.trim())) return undefined;
  return {
    zipCode: blank(v.zipCode),
    street: blank(v.street),
    number: blank(v.number),
    complement: blank(v.complement),
    district: blank(v.district),
    city: blank(v.city),
    state: blank(v.state),
  };
}

/**
 * partnerSubmitCaseAction (sem a chave). Cliente NOVO leva o cadastro básico;
 * cliente EXISTENTE leva só tipo + CPF/CNPJ — o banco usa o cadastro canônico
 * e ignora o resto (nunca sobrescreve dado de outro escritório).
 */
export function partnerSubmitInput(v: PartnerCaseValues, ownerId: string, existing: boolean): Record<string, unknown> {
  const common = { kind: v.kind, document: v.document, origin: partnerOrigin(v.clientOriginId, ownerId) };
  const client = existing
    ? common
    : {
        ...common,
        ...(v.kind === "INDIVIDUAL" ? { fullName: blank(v.fullName), birthDate: blank(v.birthDate) } : { legalName: blank(v.legalName), tradeName: blank(v.tradeName) }),
        email: blank(v.email),
        phone: blank(v.phone),
        address: address(v),
      };
  return {
    client,
    case: {
      area: v.area,
      caseTypeId: blank(v.caseTypeId),
      title: v.title.trim(),
      summary: blank(v.summary),
      opposingParty: blank(v.opposingParty),
      origin: partnerOrigin(v.caseOriginId, ownerId),
      partnerNotes: blank(v.notes),
    },
  };
}
