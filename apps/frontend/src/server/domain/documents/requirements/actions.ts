"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { createRequirementSchema, listRequirementsSchema, requirementIdSchema, satisfyRequirementSchema } from "./schemas";

/**
 * Server Actions das pendências de documento do caso. Sessão + permissão
 * (runAction) → Zod → service (que confere a superfície interna/parceiro).
 */

export async function listRequirementsAction(input: unknown) {
  return runAction({ name: "requirements.list", schema: listRequirementsSchema, input, handler: service.listRequirements });
}

export async function createRequirementAction(input: unknown) {
  return runAction({ name: "requirements.create", permission: "documents.manage", schema: createRequirementSchema, input, handler: service.createRequirement });
}

export async function requestRequirementAction(input: unknown) {
  return runAction({ name: "requirements.request", permission: "documents.manage", schema: requirementIdSchema, input, handler: (ctx, { id }) => service.requestRequirement(ctx, id) });
}

export async function satisfyRequirementAction(input: unknown) {
  return runAction({ name: "requirements.satisfy", permission: "documents.manage", schema: satisfyRequirementSchema, input, handler: service.satisfyRequirement });
}

export async function approveRequirementAction(input: unknown) {
  return runAction({ name: "requirements.approve", permission: "reviews.decide", schema: requirementIdSchema, input, handler: (ctx, { id }) => service.approveRequirement(ctx, id) });
}

export async function rejectRequirementAction(input: unknown) {
  return runAction({ name: "requirements.reject", permission: "reviews.decide", schema: requirementIdSchema, input, handler: (ctx, { id }) => service.rejectRequirement(ctx, id) });
}
