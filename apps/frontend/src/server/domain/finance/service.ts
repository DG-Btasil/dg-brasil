import { isPartner, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, DomainError, forbidden, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type {
  AllocationDTO,
  CasePartnershipDTO,
  FeeModelDTO,
  FinancialAgreementDTO,
  PartnerAgreementShareDTO,
  PartnerFinanceDTO,
  PaymentDTO,
  ReceiptDTO,
  ReceiptResultDTO,
  TransferInternalDTO,
  TransferListItemDTO,
} from "./dto";
import {
  agreementFromRow,
  agreementInsert,
  agreementShareFromRows,
  agreementUpdate,
  allocationFromRow,
  feeModelFromRow,
  feeModelInsert,
  feeModelUpdate,
  fromCents,
  partnershipInternalFromRow,
  partnershipPartnerFromRow,
  paymentFromRows,
  receiptFromRow,
  shareTotals,
  toCents,
  transferInternalFromRow,
  transferPartnerFromRow,
  type TransferPartnerRow,
  type TransferRow,
} from "./mappers";
import * as repo from "./repository";
import type {
  CancelPaymentInput,
  CancelTransferInput,
  ChangeAgreementStatusInput,
  CreateAgreementInput,
  CreateFeeModelInput,
  CreatePaymentInput,
  CreateTransferInput,
  ListAgreementsInput,
  ListAllocationsInput,
  ListFeeModelsInput,
  ListPartnerAgreementSharesInput,
  ListPaymentsInput,
  ListReceiptsInput,
  ListTransfersInput,
  MarkTransferPaidInput,
  PartnerFinanceInput,
  RegisterAdjustmentInput,
  RegisterReceiptInput,
  RegisterReversalInput,
  UpdateAgreementInput,
  UpdateFeeModelInput,
  UpdatePaymentInput,
} from "./schemas";

/**
 * Regras do financeiro (ledger operacional — não é gateway de pagamento).
 *
 * Autorização contextual aqui: o financeiro é só do ADMIN (`finance.view`,
 * `finance.manage`); o Portal do Parceiro vê SÓ a participação do próprio
 * escritório (`partnerPortal.finance.view`, PARTNER_ADMIN). PARTNER_USER,
 * LAWYER e ASSISTANT não têm financeiro.
 *
 * Segunda barreira no banco: RLS + triggers (ADMIN antes de qualquer regra,
 * ledger append-only, divisão gerada a partir do snapshot congelado,
 * transições de repasse, total nunca negativo nem acima da obrigação). As
 * contas de dinheiro (recebido, saldo, status, divisão, saldo disponível do
 * parceiro) são do BANCO; aqui só se lê e se soma o que ele derivou.
 *
 * Log: só IDs e tipos de operação — nunca valores ligados a pessoas.
 */

/* ------------------------------------------------------------------ */
/* Autorização                                                         */
/* ------------------------------------------------------------------ */

function requireFinance(ctx: ServiceContext, permission: "finance.view" | "finance.manage"): void {
  requireInternal(ctx);
  requirePermission(ctx, permission);
}

/**
 * Parceiro de quem se lê a participação. ADMIN informa (e precisa ser um
 * parceiro); PARTNER_ADMIN usa SEMPRE o da sessão — pedir outro é FORBIDDEN.
 */
async function resolvePartnerScope(ctx: ServiceContext, requested: string | undefined): Promise<string> {
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.finance.view");
    if (requested && requested !== ctx.session.organizationId) throw forbidden();
    return ctx.session.organizationId;
  }
  requireFinance(ctx, "finance.view");
  if (!requested) throw validation({ partnerOrganizationId: ["Informe o parceiro."] });
  if (!(await repo.isPartnerOrganization(ctx.db, requested))) throw notFound("Parceiro não encontrado.");
  return requested;
}

/**
 * Leitura do portal: qualquer falha vira erro genérico. Mensagem de trigger ou
 * de RLS nunca chega ao parceiro (pode citar valor ou regra interna).
 */
async function partnerSafe<T>(ctx: ServiceContext, run: () => Promise<T>): Promise<T> {
  if (!isPartner(ctx)) return run();
  try {
    return await run();
  } catch (error) {
    if (error instanceof DomainError && (error.code === "INTERNAL" || error.code === "UNAUTHORIZED")) throw new DomainError(error.code);
    throw forbidden();
  }
}

/* ------------------------------------------------------------------ */
/* Modelos de honorários (ADMIN)                                       */
/* ------------------------------------------------------------------ */

export async function listFeeModels(ctx: ServiceContext, input: ListFeeModelsInput): Promise<Page<FeeModelDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listFeeModels(ctx.db, { active: input.active, legalAreaId: input.legalAreaId }, input, {
    column: input.column,
    ascending: input.ascending,
  });
  return toPage(rows.map(feeModelFromRow), total, input);
}

export async function createFeeModel(ctx: ServiceContext, input: CreateFeeModelInput): Promise<{ id: string }> {
  requireFinance(ctx, "finance.manage");
  const id = await repo.insertFeeModel(ctx.db, feeModelInsert(input));
  ctx.log.info("finance.fee_model.created", { feeModelId: id });
  return { id };
}

export async function updateFeeModel(ctx: ServiceContext, input: UpdateFeeModelInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  await repo.updateFeeModel(ctx.db, input.id, feeModelUpdate(input.patch));
  ctx.log.info("finance.fee_model.updated", { feeModelId: input.id });
}

/* ------------------------------------------------------------------ */
/* Acordos financeiros do caso (ADMIN)                                 */
/* ------------------------------------------------------------------ */

export async function listAgreements(ctx: ServiceContext, input: ListAgreementsInput): Promise<Page<FinancialAgreementDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listAgreements(ctx.db, { legalCaseId: input.legalCaseId, status: input.status }, input, {
    column: input.column,
    ascending: input.ascending,
  });
  return toPage(rows.map(agreementFromRow), total, input);
}

export async function getAgreement(ctx: ServiceContext, id: string): Promise<FinancialAgreementDTO> {
  requireFinance(ctx, "finance.view");
  const row = await repo.getAgreement(ctx.db, id);
  if (!row) throw notFound("Acordo não encontrado.");
  return agreementFromRow(row);
}

/**
 * Cria o acordo do caso (rascunho ou já ativo). Com modelo de honorários e sem
 * termos informados, copia os termos do modelo (lido do banco, não do navegador).
 * Um ATIVO por caso: o índice único do banco decide a corrida.
 */
export async function createAgreement(ctx: ServiceContext, input: CreateAgreementInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "financial_agreements", actorId, input.idempotencyKey);
  if (existing) return { id: existing, deduplicated: true };

  let terms = input;
  if (input.feeModelId) {
    const model = await repo.getFeeModel(ctx.db, input.feeModelId);
    if (!model || !model.active) throw validation({ feeModelId: ["Modelo de honorários inexistente ou inativo."] });
    const hasTerms = [input.upfrontFee, input.fixedFee, input.installments, input.monthlyFee, input.successFeePercent].some((v) => v !== undefined);
    if (!hasTerms) {
      const m = feeModelFromRow(model);
      terms = { ...input, upfrontFee: m.upfrontFee, fixedFee: m.fixedFee, installments: m.installments, monthlyFee: m.monthlyFee, successFeePercent: m.successFeePercent };
    }
  }
  const result = await repo.insertIdempotent(ctx.db, "financial_agreements", agreementInsert(terms, actorId), actorId, input.idempotencyKey);
  if (!result.deduplicated) ctx.log.info("finance.agreement.created", { agreementId: result.id, legalCaseId: input.legalCaseId });
  return result;
}

/** Termos só mudam em rascunho. Acordo ativo/encerrado é histórico de negócio. */
export async function updateAgreement(ctx: ServiceContext, input: UpdateAgreementInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getAgreement(ctx.db, input.id);
  if (!row) throw notFound("Acordo não encontrado.");
  if (row.status !== "DRAFT") throw invalidState("Só o rascunho do acordo pode ter os termos alterados.");
  await repo.updateAgreementWhere(ctx.db, input.id, ["DRAFT"], agreementUpdate(input.patch));
  ctx.log.info("finance.agreement.updated", { agreementId: input.id });
}

const AGREEMENT_TRANSITIONS: Record<ChangeAgreementStatusInput["to"], readonly string[]> = {
  ACTIVE: ["DRAFT"],
  COMPLETED: ["ACTIVE"],
  CANCELLED: ["DRAFT", "ACTIVE"],
};

/**
 * DRAFT → ACTIVE → COMPLETED; DRAFT/ACTIVE → CANCELLED. Concluir ou cancelar
 * exige nenhuma obrigação em aberto (receber ou cancelar antes). A troca é
 * condicionada ao status lido (dois cliques não pulam estado).
 */
export async function changeAgreementStatus(ctx: ServiceContext, input: ChangeAgreementStatusInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getAgreement(ctx.db, input.id);
  if (!row) throw notFound("Acordo não encontrado.");
  if (row.status === input.to) return;
  if (!AGREEMENT_TRANSITIONS[input.to].includes(row.status)) throw invalidState("Esta mudança de situação do acordo não é permitida.");
  if (input.to !== "ACTIVE" && (await repo.countOpenPayments(ctx.db, input.id)) > 0) {
    throw businessRule("Há obrigações em aberto neste acordo: registre o recebimento ou cancele-as antes.");
  }
  await repo.updateAgreementWhere(ctx.db, input.id, [row.status], { status: input.to });
  ctx.log.info("finance.agreement.status_changed", { agreementId: input.id, to: input.to });
}

/* ------------------------------------------------------------------ */
/* Obrigações (ADMIN)                                                  */
/* ------------------------------------------------------------------ */

export async function listPayments(ctx: ServiceContext, input: ListPaymentsInput): Promise<Page<PaymentDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listPaymentBalances(ctx.db, { agreementId: input.agreementId, legalCaseId: input.legalCaseId, status: input.status }, input, {
    column: input.column,
    ascending: input.ascending,
  });
  const details = new Map((await repo.getPaymentRows(ctx.db, rows.map((r) => r.payment_id))).map((p) => [p.id, p]));
  return toPage(
    rows.map((b) => paymentFromRows(b, details.get(b.payment_id))),
    total,
    input,
  );
}

export async function getPayment(ctx: ServiceContext, id: string): Promise<PaymentDTO> {
  requireFinance(ctx, "finance.view");
  const balance = await repo.getPaymentBalance(ctx.db, id);
  if (!balance) throw notFound("Obrigação não encontrada.");
  const [detail] = await repo.getPaymentRows(ctx.db, [id]);
  return paymentFromRows(balance, detail);
}

/** Nova obrigação. Moeda vem do acordo; acordo precisa estar em rascunho ou ativo. */
export async function createPayment(ctx: ServiceContext, input: CreatePaymentInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payments", actorId, input.idempotencyKey);
  if (existing) return { id: existing, deduplicated: true };

  const agreement = await repo.getAgreement(ctx.db, input.agreementId);
  if (!agreement) throw notFound("Acordo não encontrado.");
  if (agreement.status !== "DRAFT" && agreement.status !== "ACTIVE") throw invalidState("Acordo concluído ou cancelado não recebe novas obrigações.");

  const result = await repo.insertIdempotent(
    ctx.db,
    "payments",
    {
      financial_agreement_id: input.agreementId,
      amount: input.amount,
      currency: agreement.currency,
      due_date: input.dueDate ?? null,
      payment_type: input.paymentType,
      description: input.description ?? null,
    },
    actorId,
    input.idempotencyKey,
  );
  if (!result.deduplicated) ctx.log.info("finance.payment.created", { paymentId: result.id, agreementId: input.agreementId });
  return result;
}

/** Corrige valor, vencimento ou descrição. Nunca o recebido (ledger). */
export async function updatePayment(ctx: ServiceContext, input: UpdatePaymentInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const balance = await repo.getPaymentBalance(ctx.db, input.id);
  if (!balance) throw notFound("Obrigação não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Obrigação cancelada não muda: registre outra.");
  if (input.patch.amount !== undefined && toCents(input.patch.amount) < toCents(balance.received_amount)) {
    throw businessRule("O valor da obrigação não pode ficar abaixo do que já foi recebido.");
  }
  const values: Record<string, unknown> = {};
  if ("amount" in input.patch) values.amount = input.patch.amount;
  if ("dueDate" in input.patch) values.due_date = input.patch.dueDate ?? null;
  if ("description" in input.patch) values.description = input.patch.description ?? null;
  await repo.updateOpenPayment(ctx.db, input.id, values);
  ctx.log.info("finance.payment.updated", { paymentId: input.id });
}

/** Cancela a obrigação (com motivo). Com recebimento líquido, estorne antes. */
export async function cancelPayment(ctx: ServiceContext, input: CancelPaymentInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const balance = await repo.getPaymentBalance(ctx.db, input.id);
  if (!balance) throw notFound("Obrigação não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Obrigação já cancelada.");
  if (toCents(balance.received_amount) > 0) throw businessRule("Estorne os recebimentos antes de cancelar a obrigação.");
  await repo.updateOpenPayment(ctx.db, input.id, { cancelled_at: new Date().toISOString(), cancellation_reason: input.reason });
  ctx.log.info("finance.payment.cancelled", { paymentId: input.id });
}

/* ------------------------------------------------------------------ */
/* Ledger (ADMIN) — append-only                                        */
/* ------------------------------------------------------------------ */

export async function listReceipts(ctx: ServiceContext, input: ListReceiptsInput): Promise<Page<ReceiptDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listReceipts(ctx.db, input.paymentId, input);
  return toPage(rows.map(receiptFromRow), total, input);
}

/**
 * Entrada (RECEIPT). Sem valor, quita o saldo (lido do banco). Exige acordo
 * ATIVO e obrigação não cancelada. A divisão com o parceiro é gerada pelo
 * banco na mesma transação, com o percentual congelado do snapshot.
 */
export async function registerReceipt(ctx: ServiceContext, input: RegisterReceiptInput): Promise<ReceiptResultDTO> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  // Reenvio do mesmo formulário devolve o lançamento já gravado — antes das
  // regras ("quitar saldo" reenviado encontraria saldo zero).
  const existing = await repo.findByIdempotencyKey(ctx.db, "payment_receipts", actorId, input.idempotencyKey);
  if (existing) return { receiptId: existing, deduplicated: true };

  const balance = await repo.getPaymentBalance(ctx.db, input.paymentId);
  if (!balance) throw notFound("Obrigação não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Obrigação cancelada não recebe entrada.");
  const agreement = await repo.getAgreement(ctx.db, balance.financial_agreement_id);
  if (agreement?.status !== "ACTIVE") throw invalidState("Ative o acordo antes de registrar recebimentos.");

  const balanceCents = toCents(balance.balance);
  const amountCents = input.amount !== undefined ? toCents(input.amount) : balanceCents;
  if (amountCents <= 0) throw invalidState("Esta obrigação já está quitada.");
  if (amountCents > balanceCents) throw businessRule("O recebimento excede o saldo da obrigação. Corrija a obrigação antes.");

  const result = await repo.insertIdempotent(
    ctx.db,
    "payment_receipts",
    {
      payment_id: input.paymentId,
      kind: "RECEIPT",
      amount: fromCents(amountCents),
      currency: balance.currency,
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
      method: input.method ?? null,
      notes: input.notes ?? null,
    },
    actorId,
    input.idempotencyKey,
  );
  if (!result.deduplicated) ctx.log.info("finance.receipt.registered", { receiptId: result.id, paymentId: input.paymentId, kind: "RECEIPT" });
  return { receiptId: result.id, deduplicated: result.deduplicated };
}

/**
 * Ajuste com justificativa (INCREASE soma, DECREASE subtrai). Pode apontar o
 * lançamento de entrada que corrige (mesma obrigação). Aumento exige acordo
 * ativo; redução é correção e vale em qualquer situação.
 */
export async function registerAdjustment(ctx: ServiceContext, input: RegisterAdjustmentInput): Promise<ReceiptResultDTO> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payment_receipts", actorId, input.idempotencyKey);
  if (existing) return { receiptId: existing, deduplicated: true };

  const balance = await repo.getPaymentBalance(ctx.db, input.paymentId);
  if (!balance) throw notFound("Obrigação não encontrada.");
  if (input.direction === "INCREASE") {
    if (balance.status === "CANCELLED") throw invalidState("Obrigação cancelada não recebe entrada.");
    const agreement = await repo.getAgreement(ctx.db, balance.financial_agreement_id);
    if (agreement?.status !== "ACTIVE") throw invalidState("Ative o acordo antes de registrar recebimentos.");
  }
  if (input.originalReceiptId) {
    const original = await repo.getReceipt(ctx.db, input.originalReceiptId);
    if (!original || original.payment_id !== input.paymentId) throw validation({ originalReceiptId: ["O lançamento original não é desta obrigação."] });
    if (toCents(original.amount) <= 0) throw validation({ originalReceiptId: ["Só se ajusta lançamento de entrada."] });
  }

  const result = await repo.insertIdempotent(
    ctx.db,
    "payment_receipts",
    {
      payment_id: input.paymentId,
      kind: "ADJUSTMENT",
      amount: input.direction === "INCREASE" ? input.amount : -input.amount,
      currency: balance.currency,
      original_receipt_id: input.originalReceiptId ?? null,
      notes: input.justification,
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    },
    actorId,
    input.idempotencyKey,
  );
  if (!result.deduplicated) ctx.log.info("finance.receipt.registered", { receiptId: result.id, paymentId: input.paymentId, kind: "ADJUSTMENT" });
  return { receiptId: result.id, deduplicated: result.deduplicated };
}

/**
 * Estorno de um lançamento de entrada. A obrigação e a moeda vêm do original
 * (nunca do navegador). Sem valor, estorna o que resta do original. A divisão
 * inversa é gerada pelo banco no MESMO acordo de parceria do original.
 */
export async function registerReversal(ctx: ServiceContext, input: RegisterReversalInput): Promise<ReceiptResultDTO> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payment_receipts", actorId, input.idempotencyKey);
  if (existing) return { receiptId: existing, deduplicated: true };

  const original = await repo.getReceipt(ctx.db, input.originalReceiptId);
  if (!original) throw notFound("Lançamento não encontrado.");
  if (toCents(original.amount) <= 0) throw invalidState("Só se estorna lançamento de entrada.");

  const reversedCents = (await repo.reversedAmountOf(ctx.db, original.id)).reduce((sum, v) => sum + toCents(v), 0);
  const remainingCents = toCents(original.amount) + reversedCents;
  if (remainingCents <= 0) throw invalidState("Este lançamento já foi estornado integralmente.");
  const amountCents = input.amount !== undefined ? toCents(input.amount) : remainingCents;
  if (amountCents > remainingCents) throw businessRule("O estorno excede o valor restante do lançamento.");

  const result = await repo.insertIdempotent(
    ctx.db,
    "payment_receipts",
    {
      payment_id: original.payment_id,
      kind: "REVERSAL",
      amount: -fromCents(amountCents),
      currency: original.currency,
      original_receipt_id: original.id,
      notes: input.notes ?? null,
      ...(input.occurredAt ? { occurred_at: input.occurredAt } : {}),
    },
    actorId,
    input.idempotencyKey,
  );
  if (!result.deduplicated) ctx.log.info("finance.receipt.registered", { receiptId: result.id, paymentId: original.payment_id, kind: "REVERSAL" });
  return { receiptId: result.id, deduplicated: result.deduplicated };
}

/* ------------------------------------------------------------------ */
/* Parceria: snapshot e divisões                                       */
/* ------------------------------------------------------------------ */

/** Snapshots do caso. ADMIN: histórico completo. PARTNER_ADMIN: só os do próprio escritório (RLS + filtro). */
export async function listCasePartnerships(ctx: ServiceContext, legalCaseId: string): Promise<CasePartnershipDTO> {
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.finance.view");
    const rows = await partnerSafe(ctx, () => repo.listPartnerPartnershipsByCase(ctx.db, legalCaseId, ctx.session.organizationId));
    return { surface: "PARTNER", items: rows.map(partnershipPartnerFromRow) };
  }
  requireFinance(ctx, "finance.view");
  return { surface: "INTERNAL", items: (await repo.listPartnershipsByCase(ctx.db, legalCaseId)).map(partnershipInternalFromRow) };
}

/** Divisões geradas pelo banco (visão interna completa: parceiro e escritório). Só leitura. */
export async function listAllocations(ctx: ServiceContext, input: ListAllocationsInput): Promise<Page<AllocationDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listAllocations(
    ctx.db,
    { legalCaseId: input.legalCaseId, partnerOrganizationId: input.partnerOrganizationId, receiptId: input.receiptId },
    input,
  );
  return toPage(rows.map(allocationFromRow), total, input);
}

/* ------------------------------------------------------------------ */
/* Repasses                                                            */
/* ------------------------------------------------------------------ */

/** ADMIN: todos (filtro opcional por parceiro). PARTNER_ADMIN: só os do próprio escritório, DTO reduzido. */
export async function listTransfers(ctx: ServiceContext, input: ListTransfersInput): Promise<Page<TransferListItemDTO>> {
  const sort = { column: input.column, ascending: input.ascending };
  if (isPartner(ctx)) {
    const org = await resolvePartnerScope(ctx, input.partnerOrganizationId);
    const { rows, total } = await partnerSafe(ctx, () => repo.listTransfers(ctx.db, { partnerOrganizationId: org, status: input.status }, input, sort, "PARTNER"));
    return toPage((rows as TransferPartnerRow[]).map(transferPartnerFromRow), total, input);
  }
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listTransfers(ctx.db, { partnerOrganizationId: input.partnerOrganizationId, status: input.status }, input, sort, "INTERNAL");
  return toPage((rows as TransferRow[]).map((r) => transferInternalFromRow(r)), total, input);
}

export async function getTransfer(ctx: ServiceContext, id: string): Promise<TransferInternalDTO> {
  requireFinance(ctx, "finance.view");
  const row = await repo.getTransfer(ctx.db, id);
  if (!row) throw notFound("Repasse não encontrado.");
  return transferInternalFromRow(row, await repo.listTransferItems(ctx.db, id));
}

/**
 * Registra repasse PENDING. Quem registra decide só o VALOR (e, se quiser, o
 * caso). Repasse + itens numa transação no banco (public.create_partner_transfer,
 * migration 026): consome as divisões com saldo, mais antigas primeiro e
 * travadas — dois repasses simultâneos não usam o mesmo saldo.
 */
export async function createTransfer(ctx: ServiceContext, input: CreateTransferInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  if (!(await repo.isPartnerOrganization(ctx.db, input.partnerOrganizationId))) throw notFound("Parceiro não encontrado.");
  try {
    const result = await repo.createTransferRpc(
      ctx.db,
      {
        partnerOrganizationId: input.partnerOrganizationId,
        amount: input.amount,
        reference: input.reference,
        legalCaseId: input.legalCaseId,
        idempotencyKey: input.idempotencyKey,
      },
      ctx.session.userId,
    );
    if (!result.deduplicated) ctx.log.info("finance.transfer.created", { transferId: result.transferId, partnerOrganizationId: input.partnerOrganizationId });
    return { id: result.transferId, deduplicated: result.deduplicated };
  } catch (error) {
    // 23514 da RPC = saldo insuficiente; a transação inteira volta (nada gravado).
    if (error instanceof DomainError && error.code === "INVALID_STATE") throw businessRule("O saldo disponível do parceiro é menor que o valor do repasse.");
    throw error;
  }
}

export async function markTransferPaid(ctx: ServiceContext, input: MarkTransferPaidInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getTransfer(ctx.db, input.id);
  if (!row) throw notFound("Repasse não encontrado.");
  if (row.status === "PAID") return;
  if (row.status !== "PENDING") throw invalidState("Só repasse pendente pode ser marcado como pago.");
  const values: Record<string, unknown> = { status: "PAID", paid_at: input.paidAt ?? new Date().toISOString() };
  if (input.reference !== undefined) values.reference = input.reference;
  await repo.updateTransferWhere(ctx.db, input.id, ["PENDING"], values);
  ctx.log.info("finance.transfer.paid", { transferId: input.id });
}

/** Cancela (PENDING ou PAID) com motivo. O repasse fica no histórico e deixa de consumir saldo (regra do banco). */
export async function cancelTransfer(ctx: ServiceContext, input: CancelTransferInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getTransfer(ctx.db, input.id);
  if (!row) throw notFound("Repasse não encontrado.");
  if (row.status === "CANCELLED") throw invalidState("Repasse já cancelado.");
  await repo.updateTransferWhere(ctx.db, input.id, [row.status], { status: "CANCELLED", cancellation_reason: input.reason });
  ctx.log.info("finance.transfer.cancelled", { transferId: input.id });
}

/* ------------------------------------------------------------------ */
/* Visão do parceiro (Portal: PARTNER_ADMIN; interno: ADMIN)           */
/* ------------------------------------------------------------------ */

/**
 * Resumo da participação do parceiro: só totais DELE (acumulado, em repasse,
 * repassado, disponível) e contagem de acordos. Nunca receita do escritório.
 */
export async function getPartnerFinance(ctx: ServiceContext, input: PartnerFinanceInput): Promise<PartnerFinanceDTO> {
  const org = await resolvePartnerScope(ctx, input.partnerOrganizationId);
  return partnerSafe(ctx, async () => {
    const [balances, counts] = await Promise.all([repo.listAllocationBalances(ctx.db, { partnerOrganizationId: org }), repo.countPartnerships(ctx.db, org)]);
    return { partnerOrganizationId: org, totals: shareTotals(balances), agreementCount: counts.total, activeAgreementCount: counts.active };
  });
}

/** Participação por caso (snapshot), paginada. */
export async function listPartnerAgreementShares(ctx: ServiceContext, input: ListPartnerAgreementSharesInput): Promise<Page<PartnerAgreementShareDTO>> {
  const org = await resolvePartnerScope(ctx, input.partnerOrganizationId);
  return partnerSafe(ctx, async () => {
    const { rows, total } = await repo.listPartnershipsByPartner(ctx.db, org, input.includeCancelled, input);
    const balances = rows.length ? await repo.listAllocationBalances(ctx.db, { partnerOrganizationId: org, agreementIds: rows.map((r) => r.id) }) : [];
    return toPage(
      rows.map((r) => agreementShareFromRows(r, balances)),
      total,
      input,
    );
  });
}
