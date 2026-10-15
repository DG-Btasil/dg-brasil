import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import type { OwnerOfficeDTO } from "@/server/domain/organizations/dto";
import type { Office } from "@/types";
import type { OfficeFormOutput } from "./schemas";

/**
 * Escritório proprietário: DTO do servidor ↔ formulário de Configurações →
 * Geral. Puro e testado. OAB estruturada no banco ({ estado, número }) e em
 * texto no formulário ("OAB/SP 123.456"). Vazio = limpar (null) no PATCH.
 */

export function officeFromDto(dto: OwnerOfficeDTO): Office {
  return { ...dto, oab: dto.oab ? `OAB/${dto.oab.state} ${dto.oab.number}` : undefined } as Office;
}

/**
 * "OAB/SP 123.456" (ou "SP 123456") → { state: "SP", number: "123456" };
 * vazio, UF inexistente ou número fora de 1–10 letras/dígitos → null. O
 * formulário recusa o que não passa aqui (nunca grava "limpo" sem avisar).
 */
export function parseOab(text: string | undefined): { state: string; number: string } | null {
  const m = /^\s*(?:OAB\s*\/?\s*)?([A-Za-z]{2})\s*[/\-]?\s*([0-9A-Za-z.\-\s]+)$/i.exec(text ?? "");
  if (!m) return null;
  const state = m[1].toUpperCase();
  const number = m[2].replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (!(BRAZILIAN_STATES as readonly string[]).includes(state) || !/^[0-9A-Z]{1,10}$/.test(number)) return null;
  return { state, number };
}

const filled = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function officePatchToServer(v: OfficeFormOutput): Record<string, unknown> {
  const hasAddress = Boolean(v.street || v.city || v.zipCode || v.district || v.number);
  return {
    name: v.name.trim(),
    legalName: filled(v.legalName),
    cnpj: filled(v.cnpj),
    oab: parseOab(v.oab),
    principalLawyer: filled(v.principalLawyer),
    email: filled(v.email),
    phone: filled(v.phone),
    website: filled(v.website),
    address: hasAddress
      ? {
          zipCode: filled(v.zipCode) ?? undefined,
          street: filled(v.street) ?? undefined,
          number: filled(v.number) ?? undefined,
          complement: filled(v.complement) ?? undefined,
          district: filled(v.district) ?? undefined,
          city: filled(v.city) ?? undefined,
          state: filled(v.state) ?? undefined,
          country: "BR",
        }
      : null,
    statesOfPractice: v.statesOfPractice,
    units: (v.units ?? "")
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean),
  };
}
