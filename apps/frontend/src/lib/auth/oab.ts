import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import type { Role } from "@/lib/permissions";

/**
 * OAB no convite e no cadastro da pessoa (Roadmap 2.0, migration 048).
 * - LAWYER (escritório): quem convida PRECISA informar a OAB.
 * - ADMIN, PARTNER_ADMIN e PARTNER_USER: opcional — o usuário do parceiro
 *   pode ser secretária ou outra função sem OAB (QA E-13). Quem tem OAB
 *   cadastra quantas quiser depois, em Configurações → Sua conta → Minhas OABs
 *   (equipe). No portal do parceiro, o único lugar de OAB é "OABs acompanhadas".
 * - ASSISTANT: não leva OAB.
 */
export const OAB_REQUIRED_ROLES: readonly Role[] = ["LAWYER"];
export const OAB_OPTIONAL_ROLES: readonly Role[] = ["ADMIN", "PARTNER_ADMIN", "PARTNER_USER"];

export const OAB_UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

/** Número só com dígitos (e uma letra final, se houver) e UF em maiúsculas; null = vazio; "invalid" = formato errado. */
export function normalizeOab(oab: { number: string; state: string } | undefined): { number: string; state: string } | null | "invalid" {
  if (!oab || (!oab.number.trim() && !oab.state.trim())) return null;
  const number = oab.number.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const state = oab.state.trim().toUpperCase();
  return /^[0-9]{1,8}[A-Z]?$/.test(number) && /^[A-Z]{2}$/.test(state) ? { number, state } : "invalid";
}

export function formatOab(number: string, state: string): string {
  return `OAB/${state} ${number}`;
}
