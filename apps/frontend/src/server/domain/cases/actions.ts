"use server";

import { runAction } from "@/server/core/action";
import { enforcePartnerTaxIdLimit } from "@/server/core/rate-limit";
import * as service from "./service";
import {
  acceptCaseSchema,
  assignLawyerSchema,
  caseIdSchema,
  changeOriginSchema,
  createCaseSchema,
  listCasesSchema,
  overrideStatusSchema,
  partnerSubmitCaseSchema,
  rejectCaseSchema,
  updateCaseSchema,
} from "./schemas";

/**
 * Server Actions de Caso — a única porta do navegador para este domínio.
 * Cada uma: sessão + permissão (runAction) → Zod → service. O input é
 * `unknown` de propósito: nada do navegador é confiado sem passar no schema.
 *
 * Leitura, edição e envio servem às duas superfícies (interna e Portal do
 * Parceiro), então a permissão fica no service (requireAnyPermission); as
 * decisões declaram a permissão já na fronteira.
 */

export async function listCasesAction(input: unknown) {
  return runAction({ name: "cases.list", schema: listCasesSchema, input, handler: service.listCases });
}

export async function getCaseAction(input: unknown) {
  return runAction({ name: "cases.get", schema: caseIdSchema, input, handler: (ctx, { id }) => service.getCase(ctx, id) });
}

export async function createCaseAction(input: unknown) {
  return runAction({ name: "cases.create", permission: "cases.edit", schema: createCaseSchema, input, handler: service.createCase });
}

export async function partnerSubmitCaseAction(input: unknown) {
  return runAction({
    name: "cases.partner_submit",
    permission: "partnerPortal.cases.create",
    schema: partnerSubmitCaseSchema,
    input,
    // Cadastro por CPF/CNPJ do parceiro: mesmo limite da consulta (best-effort, na aplicação).
    handler: (ctx, data) => {
      enforcePartnerTaxIdLimit(ctx);
      return service.partnerSubmitCase(ctx, data);
    },
  });
}

export async function updateCaseAction(input: unknown) {
  return runAction({ name: "cases.update", schema: updateCaseSchema, input, handler: service.updateCase });
}

export async function submitCaseAction(input: unknown) {
  return runAction({ name: "cases.submit", schema: caseIdSchema, input, handler: (ctx, { id }) => service.submitCase(ctx, id) });
}

export async function requestCaseDocumentsAction(input: unknown) {
  return runAction({
    name: "cases.request_documents",
    permission: "cases.edit",
    schema: caseIdSchema,
    input,
    handler: (ctx, { id }) => service.requestCaseDocuments(ctx, id),
  });
}

export async function acceptCaseAction(input: unknown) {
  return runAction({ name: "cases.accept", permission: "cases.decide", schema: acceptCaseSchema, input, handler: service.acceptCase });
}

export async function rejectCaseAction(input: unknown) {
  return runAction({ name: "cases.reject", permission: "cases.decide", schema: rejectCaseSchema, input, handler: service.rejectCase });
}

export async function startCaseAction(input: unknown) {
  return runAction({ name: "cases.start", permission: "cases.decide", schema: caseIdSchema, input, handler: (ctx, { id }) => service.startCase(ctx, id) });
}

export async function closeCaseAction(input: unknown) {
  return runAction({ name: "cases.close", permission: "cases.decide", schema: caseIdSchema, input, handler: (ctx, { id }) => service.closeCase(ctx, id) });
}

export async function archiveCaseAction(input: unknown) {
  return runAction({ name: "cases.archive", permission: "cases.decide", schema: caseIdSchema, input, handler: (ctx, { id }) => service.archiveCase(ctx, id) });
}

export async function assignCaseLawyerAction(input: unknown) {
  return runAction({ name: "cases.assign_lawyer", permission: "cases.edit", schema: assignLawyerSchema, input, handler: service.assignCaseLawyer });
}

export async function changeCaseOriginAction(input: unknown) {
  return runAction({ name: "cases.change_origin", schema: changeOriginSchema, input, handler: service.changeCaseOrigin });
}

export async function overrideCaseStatusAction(input: unknown) {
  // Sem permissão própria na matriz: o service exige papel ADMIN (e o banco também).
  return runAction({ name: "cases.override_status", schema: overrideStatusSchema, input, handler: service.overrideCaseStatus });
}
