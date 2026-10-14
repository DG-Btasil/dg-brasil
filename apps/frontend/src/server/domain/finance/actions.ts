"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  cancelPaymentSchema,
  cancelTransferSchema,
  changeAgreementStatusSchema,
  createAgreementSchema,
  createFeeModelSchema,
  createPaymentSchema,
  createTransferSchema,
  idSchema,
  listAgreementsSchema,
  listAllocationsSchema,
  listCasePartnershipsSchema,
  listFeeModelsSchema,
  listPartnerAgreementSharesSchema,
  listPaymentsSchema,
  listReceiptsSchema,
  listTransfersSchema,
  markTransferPaidSchema,
  partnerFinanceSchema,
  registerAdjustmentSchema,
  registerReceiptSchema,
  registerReversalSchema,
  updateAgreementSchema,
  updateFeeModelSchema,
  updatePaymentSchema,
} from "./schemas";

/**
 * Server Actions do Financeiro — a única porta do navegador para este domínio.
 * Cada uma: sessão + permissão (runAction) → Zod → service (que confere de
 * novo, com o contexto). As do ADMIN exigem `finance.view`/`finance.manage`
 * já na fronteira; as que o Portal do Parceiro também usa (snapshot, repasses,
 * resumo) decidem a superfície no service. O input é `unknown` de propósito.
 */

/* Modelos de honorários */

export async function listFeeModelsAction(input: unknown) {
  return runAction({ name: "finance.fee_models.list", permission: "finance.view", schema: listFeeModelsSchema, input, handler: service.listFeeModels });
}

export async function createFeeModelAction(input: unknown) {
  return runAction({ name: "finance.fee_models.create", permission: "finance.manage", schema: createFeeModelSchema, input, handler: service.createFeeModel });
}

export async function updateFeeModelAction(input: unknown) {
  return runAction({ name: "finance.fee_models.update", permission: "finance.manage", schema: updateFeeModelSchema, input, handler: service.updateFeeModel });
}

/* Acordos */

export async function listAgreementsAction(input: unknown) {
  return runAction({ name: "finance.agreements.list", permission: "finance.view", schema: listAgreementsSchema, input, handler: service.listAgreements });
}

/** Lista de acordos com rótulos do caso e totais do ledger (ADMIN). */
export async function listAgreementRowsAction(input: unknown) {
  return runAction({ name: "finance.agreements.rows", permission: "finance.view", schema: listAgreementsSchema, input, handler: service.listAgreementRows });
}

/** Visão geral agregada no servidor (ADMIN). */
export async function getFinanceSummaryAction(input?: unknown) {
  return runAction({ name: "finance.summary", permission: "finance.view", schema: z.unknown(), input, handler: (ctx) => service.getFinanceSummary(ctx) });
}

export async function getAgreementAction(input: unknown) {
  return runAction({ name: "finance.agreements.get", permission: "finance.view", schema: idSchema, input, handler: (ctx, { id }) => service.getAgreement(ctx, id) });
}

export async function createAgreementAction(input: unknown) {
  return runAction({ name: "finance.agreements.create", permission: "finance.manage", schema: createAgreementSchema, input, handler: service.createAgreement });
}

export async function updateAgreementAction(input: unknown) {
  return runAction({ name: "finance.agreements.update", permission: "finance.manage", schema: updateAgreementSchema, input, handler: service.updateAgreement });
}

export async function changeAgreementStatusAction(input: unknown) {
  return runAction({ name: "finance.agreements.status", permission: "finance.manage", schema: changeAgreementStatusSchema, input, handler: service.changeAgreementStatus });
}

/* Obrigações */

export async function listPaymentsAction(input: unknown) {
  return runAction({ name: "finance.payments.list", permission: "finance.view", schema: listPaymentsSchema, input, handler: service.listPayments });
}

export async function getPaymentAction(input: unknown) {
  return runAction({ name: "finance.payments.get", permission: "finance.view", schema: idSchema, input, handler: (ctx, { id }) => service.getPayment(ctx, id) });
}

export async function createPaymentAction(input: unknown) {
  return runAction({ name: "finance.payments.create", permission: "finance.manage", schema: createPaymentSchema, input, handler: service.createPayment });
}

export async function updatePaymentAction(input: unknown) {
  return runAction({ name: "finance.payments.update", permission: "finance.manage", schema: updatePaymentSchema, input, handler: service.updatePayment });
}

export async function cancelPaymentAction(input: unknown) {
  return runAction({ name: "finance.payments.cancel", permission: "finance.manage", schema: cancelPaymentSchema, input, handler: service.cancelPayment });
}

/* Ledger (append-only) */

export async function listReceiptsAction(input: unknown) {
  return runAction({ name: "finance.receipts.list", permission: "finance.view", schema: listReceiptsSchema, input, handler: service.listReceipts });
}

export async function registerReceiptAction(input: unknown) {
  return runAction({ name: "finance.receipts.receipt", permission: "finance.manage", schema: registerReceiptSchema, input, handler: service.registerReceipt });
}

export async function registerAdjustmentAction(input: unknown) {
  return runAction({ name: "finance.receipts.adjustment", permission: "finance.manage", schema: registerAdjustmentSchema, input, handler: service.registerAdjustment });
}

export async function registerReversalAction(input: unknown) {
  return runAction({ name: "finance.receipts.reversal", permission: "finance.manage", schema: registerReversalSchema, input, handler: service.registerReversal });
}

/* Parceria: snapshot e divisões */

export async function listCasePartnershipsAction(input: unknown) {
  return runAction({
    name: "finance.partnerships.by_case",
    schema: listCasePartnershipsSchema,
    input,
    handler: (ctx, { legalCaseId }) => service.listCasePartnerships(ctx, legalCaseId),
  });
}

export async function listAllocationsAction(input: unknown) {
  return runAction({ name: "finance.allocations.list", permission: "finance.view", schema: listAllocationsSchema, input, handler: service.listAllocations });
}

/* Repasses */

export async function listTransfersAction(input: unknown) {
  return runAction({ name: "finance.transfers.list", schema: listTransfersSchema, input, handler: service.listTransfers });
}

export async function getTransferAction(input: unknown) {
  return runAction({ name: "finance.transfers.get", permission: "finance.view", schema: idSchema, input, handler: (ctx, { id }) => service.getTransfer(ctx, id) });
}

export async function createTransferAction(input: unknown) {
  return runAction({ name: "finance.transfers.create", permission: "finance.manage", schema: createTransferSchema, input, handler: service.createTransfer });
}

export async function markTransferPaidAction(input: unknown) {
  return runAction({ name: "finance.transfers.paid", permission: "finance.manage", schema: markTransferPaidSchema, input, handler: service.markTransferPaid });
}

export async function cancelTransferAction(input: unknown) {
  return runAction({ name: "finance.transfers.cancel", permission: "finance.manage", schema: cancelTransferSchema, input, handler: service.cancelTransfer });
}

/* Visão do parceiro (Portal: PARTNER_ADMIN; interno: ADMIN informando o parceiro) */

export async function getPartnerFinanceAction(input: unknown) {
  return runAction({ name: "finance.partner.summary", schema: partnerFinanceSchema, input, handler: service.getPartnerFinance });
}

export async function listPartnerAgreementSharesAction(input: unknown) {
  return runAction({
    name: "finance.partner.shares",
    schema: listPartnerAgreementSharesSchema,
    input,
    handler: service.listPartnerAgreementShares,
  });
}

/** Atalho do Portal: resumo do próprio escritório (sem parâmetros). */
export async function getMyPartnerFinanceAction() {
  return runAction({ name: "finance.partner.mine", permission: "partnerPortal.finance.view", schema: z.object({}), input: {}, handler: (ctx) => service.getPartnerFinance(ctx, {}) });
}
