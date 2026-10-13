"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  changePartnerShareSchema,
  createPartnerSchema,
  listOrganizationUsersSchema,
  listPartnersSchema,
  organizationIdSchema,
  setPartnerStatusSchema,
  updateOwnerOfficeSchema,
  updatePartnerSchema,
} from "./schemas";

/**
 * Server Actions de organização — a única porta do navegador para este
 * domínio. Cada uma: sessão + permissão (runAction) → Zod → service. O input
 * é `unknown` de propósito. Gestão de equipe (convites, papéis, MFA) fica em
 * src/server/auth/team-actions.ts.
 */

/** Operações sem parâmetro: aceitam vazio e ignoram qualquer outro campo. */
const noInput = z.object({}).optional();

export async function getOwnerOfficeAction(input?: unknown) {
  return runAction({ name: "organizations.owner.get", schema: noInput, input, handler: (ctx) => service.getOwnerOffice(ctx) });
}

export async function updateOwnerOfficeAction(input: unknown) {
  return runAction({ name: "organizations.owner.update", permission: "settings.office.edit", schema: updateOwnerOfficeSchema, input, handler: service.updateOwnerOffice });
}

export async function listPartnersAction(input: unknown) {
  return runAction({ name: "partners.list", permission: "partners.view", schema: listPartnersSchema, input, handler: service.listPartners });
}

export async function getPartnerAction(input: unknown) {
  return runAction({ name: "partners.get", schema: organizationIdSchema, input, handler: (ctx, { id }) => service.getPartner(ctx, id) });
}

export async function getMyPartnerOfficeAction(input?: unknown) {
  return runAction({ name: "partners.mine", permission: "partnerPortal.view", schema: noInput, input, handler: (ctx) => service.getMyPartnerOffice(ctx) });
}

export async function createPartnerAction(input: unknown) {
  return runAction({ name: "partners.create", permission: "partners.manage", schema: createPartnerSchema, input, handler: service.createPartner });
}

export async function updatePartnerAction(input: unknown) {
  return runAction({ name: "partners.update", permission: "partners.manage", schema: updatePartnerSchema, input, handler: service.updatePartner });
}

export async function setPartnerStatusAction(input: unknown) {
  return runAction({ name: "partners.set_status", permission: "partners.manage", schema: setPartnerStatusSchema, input, handler: service.setPartnerStatus });
}

export async function changePartnerShareAction(input: unknown) {
  return runAction({ name: "partners.change_share", permission: "partners.manage", schema: changePartnerShareSchema, input, handler: service.changePartnerShare });
}

export async function listOrganizationUsersAction(input: unknown) {
  return runAction({ name: "organizations.users.list", schema: listOrganizationUsersSchema, input, handler: service.listOrganizationUsers });
}
