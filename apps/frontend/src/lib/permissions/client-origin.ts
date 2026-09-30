/**
 * Origem do cliente: quais escritórios o usuário pode atribuir (fonte única).
 *
 * - Equipe interna com permissão de cadastro: Bárbara Cardoso Advocacia ou
 *   qualquer escritório parceiro ATIVO (permite corrigir/atribuir a origem).
 * - Usuário de parceiro (admin ou usuário): SOMENTE o próprio escritório ou
 *   Bárbara Cardoso Advocacia. Nunca outro parceiro.
 *
 * Usado pelos formulários (opções do Select) e pelas ações do store (que
 * recusam qualquer outro valor, mesmo se o estado da tela for manipulado).
 * No backend, a mesma regra vale no servidor, com o usuário vindo da sessão.
 */
import type { ID, Office, PartnerOffice } from "@/types";
import { audienceOf, can, type Role } from "./index";

export interface ClientOriginOption {
  value: ID;
  label: string;
}

export interface OriginContext {
  role: Role | undefined;
  /** Escritório parceiro do usuário (sessão). */
  partnerOfficeId?: ID;
  owner: Pick<Office, "id" | "name">;
  /** Parceiros conhecidos pelo chamador (no servidor: todos). */
  partners: Pick<PartnerOffice, "id" | "name" | "status">[];
}

export function getAllowedClientOrigins(ctx: OriginContext): ClientOriginOption[] {
  const owner = { value: ctx.owner.id, label: ctx.owner.name };
  if (audienceOf(ctx.role) === "PARTNER") {
    const own = ctx.partners.find((p) => p.id === ctx.partnerOfficeId);
    return own ? [{ value: own.id, label: own.name }, owner] : [owner];
  }
  if (!can(ctx.role, "clients.edit")) return [];
  return [
    owner,
    ...ctx.partners
      .filter((p) => p.status === "ACTIVE")
      .map((p) => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
  ];
}

/** Origem sugerida ao abrir o cadastro: o escritório do próprio usuário. */
export function defaultClientOrigin(ctx: OriginContext): ID {
  return audienceOf(ctx.role) === "PARTNER" && ctx.partnerOfficeId ? ctx.partnerOfficeId : ctx.owner.id;
}

export function isAllowedClientOrigin(ctx: OriginContext, officeId: ID | undefined): boolean {
  return !!officeId && getAllowedClientOrigins(ctx).some((o) => o.value === officeId);
}

/** Nome do escritório de origem (proprietário ou parceiro). */
export function originOfficeName(officeId: ID | undefined, owner: Pick<Office, "id" | "name">, partners: Pick<PartnerOffice, "id" | "name">[]): string | undefined {
  if (!officeId) return undefined;
  if (officeId === owner.id) return owner.name;
  return partners.find((p) => p.id === officeId)?.name;
}
