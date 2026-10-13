import { onlyDigits } from "@/lib/formatting";
import { addressToServer } from "@/features/clients/server-input";
import { parsePercent, type PartnerCreateValues, type PartnerDataValues } from "./schemas";

/**
 * Formulário de parceiro (strings) → entrada das Server Actions de
 * organização. Puro; o servidor valida de novo (server/domain/organizations).
 */

type Json = Record<string, unknown>;

function oab(v: PartnerDataValues) {
  const number = onlyDigits(v.responsibleOab) || v.responsibleOab.trim();
  return number && v.oabState ? { number, state: v.oabState } : undefined;
}

export function partnerCreateInput(v: PartnerCreateValues): Json {
  return {
    name: v.name.trim(),
    legalName: v.legalName,
    cnpj: v.cnpj,
    email: v.email,
    phone: v.phone,
    address: addressToServer(v.address),
    responsibleName: v.responsibleName,
    responsibleOab: oab(v),
    notes: v.notes,
    partnershipActive: true,
    partnershipPercentage: parsePercent(v.partnershipPercentage),
    ownerPercentage: parsePercent(v.ownerPercentage),
  };
}

/** PATCH do cadastro: texto vazio apaga; endereço vazio vira null. A divisão tem operação própria. */
export function partnerPatch(v: PartnerDataValues): Json {
  return {
    name: v.name.trim(),
    legalName: v.legalName,
    cnpj: v.cnpj,
    email: v.email,
    phone: v.phone,
    address: addressToServer(v.address) ?? null,
    responsibleName: v.responsibleName,
    responsibleOab: oab(v) ?? null,
    notes: v.notes,
  };
}

/** Erros de campo do servidor → nomes do formulário. */
export const PARTNER_FIELD_MAP: Record<string, string> = {
  "responsibleOab.number": "responsibleOab",
  "responsibleOab.state": "oabState",
  "address.zipCode": "address.zipCode",
  "address.state": "address.state",
};
