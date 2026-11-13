import { isPartner, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, DomainError, forbidden, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import { collectForExport, exportCsv, mapChunks, type ExportFileDTO } from "@/server/domain/exports/service";
import type {
  AgreementListItemDTO,
  AllocationDTO,
  CasePartnershipDTO,
  ExpenseDTO,
  ExpenseSummaryDTO,
  FeeModelDTO,
  FinanceSummaryDTO,
  FinancialAgreementDTO,
  PartnerAgreementShareDTO,
  PartnerFinanceDTO,
  PaymentDTO,
  ProcessFinanceDetailDTO,
  ProcessFinanceDTO,
  ProcessFinanceTotalsDTO,
  ReceiptDTO,
  ReceiptResultDTO,
  ReceiptStatementDTO,
  ReceivableAgingDTO,
  ReceivablesDTO,
  TransferInternalDTO,
  TransferListItemDTO, PartnerShareDetailDTO } from "./dto";
import { receivableAging } from "./aging";
import {
  AGREEMENT_EXPORT_COLUMNS,
  EXPENSE_EXPORT_COLUMNS,
  PROCESS_FINANCE_EXPORT_COLUMNS,
  RECEIPT_EXPORT_COLUMNS,
  RECEIVABLE_EXPORT_COLUMNS,
  withReceiptShares,
  type ProcessFinanceExportRow,
} from "./export";
import {
  agreementFromRow,
  agreementInsert,
  agreementListItemFromRow,
  financeSummaryFromRaw,
  lastMonths,
  agreementShareFromRows,
  agreementUpdate,
  allocationFromRow,
  expenseFromRow,
  expenseInsert,
  expenseUpdate,
  expensesByCategory,
  feeModelFromRow,
  feeModelInsert,
  feeModelUpdate,
  fromCents,
  monthlyPaidExpenses,
  partnershipInternalFromRow,
  partnershipPartnerFromRow,
  paymentFromRows,
  processFinanceFromRow,
  processFinanceTotalsFromRow,
  receiptFromRow,
  receiptStatementItemFromRow,
  receiptStatementTotalsFromRaw,
  receivableFromRow,
  receivablesTotalsFromRaw,
  shareTotals,
  toCents,
  transferInternalFromRow,
  transferPartnerFromRow,
  type TransferPartnerRow,
  type TransferRow, shareTransfersFromRows, compositionByFeeModel } from "./mappers";
import * as repo from "./repository";
import { pastInstant } from "./schemas";
import type {
  CancelExpenseInput,
  CancelPaymentInput,
  CancelTransferInput,
  ChangeAgreementStatusInput,
  CreateAgreementInput,
  CreateExpenseInput,
  CreateFeeModelInput,
  CreatePaymentInput,
  CreateTransferInput,
  ListAgreementRowsInput,
  ListAgreementsInput,
  ListAllocationsInput,
  ListExpensesInput,
  ListFeeModelsInput,
  ListPartnerAgreementSharesInput,
  ListPaymentsInput,
  ListProcessFinanceInput,
  ListReceiptStatementInput,
  ListReceiptsInput,
  ListReceivablesInput,
  ListTransfersInput,
  MarkTransferPaidInput,
  PartnerFinanceInput,
  RegisterAdjustmentInput,
  RegisterReceiptInput,
  RegisterReversalInput,
  ReopenAgreementInput,
  UpdateAgreementInput,
  UpdateExpenseInput,
  UpdateFeeModelInput,
  UpdatePaymentInput, CreatePaymentScheduleInput } from "./schemas";

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
 * transições de repasse, total nunca negativo nem acima da parcela). As
 * contas de dinheiro (recebido, saldo, status, divisão, saldo disponível do
 * parceiro, totais das listas e da visão geral) são do BANCO; aqui só se lê.
 *
 * Vocabulário das mensagens (o que a pessoa lê): "contrato" e "parcela". No
 * código e no banco os nomes continuam `agreement` e `payment`.
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
  const { rows, total } = await repo.listAgreements(ctx.db, { legalCaseId: input.legalCaseId, legalProcessId: input.legalProcessId, status: input.status }, input, {
    column: input.column,
    ascending: input.ascending,
  });
  return toPage(rows.map(agreementFromRow), total, input);
}

export async function getAgreement(ctx: ServiceContext, id: string): Promise<FinancialAgreementDTO> {
  requireFinance(ctx, "finance.view");
  const row = await repo.getAgreement(ctx.db, id);
  if (!row) throw notFound("Contrato não encontrado.");
  return agreementFromRow(row);
}

/**
 * Cria o contrato do PROCESSO (rascunho ou já ativo; Roadmap 2.0, 046). O caso
 * é lido do processo no servidor (excluído ou sem acesso = não encontrado).
 * Com modelo de honorários e sem termos informados, copia os termos do modelo
 * (lido do banco, não do navegador). Um ATIVO por processo: o índice único do
 * banco decide a corrida.
 */
export async function createAgreement(ctx: ServiceContext, input: CreateAgreementInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "financial_agreements", actorId, input.idempotencyKey);
  if (existing) return { id: existing, deduplicated: true };

  const process = await repo.getProcessRef(ctx.db, input.legalProcessId);
  if (!process) throw validation({ legalProcessId: ["Processo não encontrado ou excluído."] }, "Processo não encontrado ou excluído.");

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
  const result = await repo.insertIdempotent(ctx.db, "financial_agreements", agreementInsert(terms, actorId, process.legal_case_id), actorId, input.idempotencyKey);
  if (!result.deduplicated) ctx.log.info("finance.agreement.created", { agreementId: result.id, legalCaseId: process.legal_case_id, legalProcessId: process.id });
  return result;
}

/**
 * Lista de contratos com rótulos e totais do livro (view finance_agreement_list,
 * 064): busca por cliente, período e vencimento, tudo filtrado, somado e
 * paginado NO BANCO.
 */
export async function listAgreementRows(ctx: ServiceContext, input: ListAgreementRowsInput): Promise<Page<AgreementListItemDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listAgreementRows(ctx.db, agreementRowFilters(input), input, { column: input.column, ascending: input.ascending });
  return toPage(rows.map(agreementListItemFromRow), total, input);
}

/** Filtros da lista de contratos como o repositório espera (os mesmos na tela e na planilha). */
function agreementRowFilters(input: ListAgreementRowsInput): repo.AgreementListFilters {
  return {
    legalCaseId: input.legalCaseId,
    legalProcessId: input.legalProcessId,
    status: input.status,
    q: input.q,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    dueFrom: input.dueFrom,
    dueTo: input.dueTo,
  };
}

/**
 * Visão geral (ADMIN): totais das parcelas, contratos por situação e recebido
 * líquido por mês, somados NO BANCO numa chamada (public.finance_summary,
 * 064). `totals` é a mesma conta dos totais por processo: a Home e o
 * Financeiro leem daqui e mostram o mesmo número.
 */
export async function getFinanceSummary(ctx: ServiceContext): Promise<FinanceSummaryDTO> {
  requireFinance(ctx, "finance.view");
  const [raw, byModel] = await Promise.all([repo.getFinanceSummary(ctx.db, 12), repo.contractedByFeeModel(ctx.db)]);
  return financeSummaryFromRaw(raw, compositionByFeeModel(byModel));
}

/**
 * "A receber por vencimento" (E-06, ADMIN): saldo em aberto das obrigações
 * dos contratos de PROCESSO por faixa (em atraso, até 30, 31–60, 61–90, acima
 * de 90 dias), somado no SERVIDOR. Duas leituras em paralelo (saldos em aberto
 * da view payment_balances e os contratos de processo), cruzadas aqui: sem
 * embed a partir da view. Contrato antigo (só do caso) fica fora, como nos
 * totais por processo (046) — o aviso de contratos antigos da visão geral
 * cobre a diferença.
 */
export async function getReceivableAging(ctx: ServiceContext, now = new Date()): Promise<ReceivableAgingDTO> {
  requireFinance(ctx, "finance.view");
  const [balances, agreements] = await Promise.all([repo.openBalances(ctx.db), repo.processAgreementIds(ctx.db)]);
  const truncated = balances.truncated || agreements.truncated;
  if (truncated) ctx.log.warn("finance.receivable_aging_truncated", {});
  return { ...receivableAging(balances.rows, now, new Set(agreements.ids)), truncated };
}

/** Termos só mudam em rascunho. Contrato ativo/encerrado é histórico de negócio. */
export async function updateAgreement(ctx: ServiceContext, input: UpdateAgreementInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getAgreement(ctx.db, input.id);
  if (!row) throw notFound("Contrato não encontrado.");
  if (row.status !== "DRAFT") throw invalidState("Só o rascunho do contrato pode ter os termos alterados.");
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
 * exige nenhuma parcela em aberto (receber ou cancelar antes). A troca é
 * condicionada ao status lido (dois cliques não pulam estado). Voltar de
 * concluído/cancelado para ativo é `reopenAgreement` (com motivo).
 */
export async function changeAgreementStatus(ctx: ServiceContext, input: ChangeAgreementStatusInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getAgreement(ctx.db, input.id);
  if (!row) throw notFound("Contrato não encontrado.");
  if (row.status === input.to) return;
  if (!AGREEMENT_TRANSITIONS[input.to].includes(row.status)) {
    if (input.to === "ACTIVE" && REOPENABLE.includes(row.status)) throw invalidState("Para voltar a ativo, reabra o contrato informando o motivo.");
    throw invalidState("Esta mudança de situação do contrato não é permitida.");
  }
  if (input.to !== "ACTIVE" && (await repo.countOpenPayments(ctx.db, input.id)) > 0) {
    throw businessRule("Há parcelas em aberto neste contrato: registre o recebimento ou cancele-as antes.");
  }
  await repo.updateAgreementWhere(ctx.db, input.id, [row.status], { status: input.to });
  ctx.log.info("finance.agreement.status_changed", { agreementId: input.id, to: input.to });
}

const REOPENABLE: readonly string[] = ["COMPLETED", "CANCELLED"];

/**
 * Reabre contrato concluído ou cancelado (064): volta a ATIVO, com motivo. É o
 * caminho para estornar ou ajustar depois de concluir (todo lançamento exige
 * contrato ativo). O banco grava quem reabriu, quando e o motivo, audita
 * (FINANCIAL_AGREEMENT_REOPENED) e recusa se o processo já tem outro contrato
 * ativo. Os termos continuam congelados.
 */
export async function reopenAgreement(ctx: ServiceContext, input: ReopenAgreementInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getAgreement(ctx.db, input.id);
  if (!row) throw notFound("Contrato não encontrado.");
  if (!REOPENABLE.includes(row.status)) throw invalidState("Só contrato concluído ou cancelado pode ser reaberto.");
  // A guarda do banco exige o motivo e a data nesta gravação; autor e data definitivos são os dela.
  await repo.updateAgreementWhere(ctx.db, input.id, [row.status], { status: "ACTIVE", reopen_reason: input.reason, reopened_at: new Date().toISOString() });
  ctx.log.info("finance.agreement.reopened", { agreementId: input.id, from: row.status });
}

/** Mensagem para lançamento em contrato que não está ativo (a mesma regra da guarda do banco, 064). */
function ledgerBlockedMessage(status: string | undefined, entry: boolean): string {
  if (entry) return "Ative o contrato antes de registrar recebimentos.";
  if (status === "COMPLETED") return "Este contrato está concluído. Reabra o contrato antes de registrar estorno ou ajuste.";
  if (status === "CANCELLED") return "Este contrato está cancelado. Reabra o contrato antes de registrar estorno ou ajuste.";
  return "Ative o contrato antes de registrar estorno ou ajuste.";
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
  if (!balance) throw notFound("Parcela não encontrada.");
  const [detail] = await repo.getPaymentRows(ctx.db, [id]);
  return paymentFromRows(balance, detail);
}

/** Nova parcela. Moeda vem do contrato; o contrato precisa estar em rascunho ou ativo. */
export async function createPayment(ctx: ServiceContext, input: CreatePaymentInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payments", actorId, input.idempotencyKey);
  if (existing) return { id: existing, deduplicated: true };

  const agreement = await repo.getAgreement(ctx.db, input.agreementId);
  if (!agreement) throw notFound("Contrato não encontrado.");
  if (agreement.status !== "DRAFT" && agreement.status !== "ACTIVE") throw invalidState("Contrato concluído ou cancelado não recebe novas parcelas. Reabra o contrato antes.");

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

/**
 * Cronograma de parcelas (035): o BANCO calcula e grava as N obrigações numa
 * transação (todas ou nenhuma), com centavos exatos (resto nas primeiras).
 * Mesma chave = mesmo cronograma. Só cria OBRIGAÇÕES: recebimento, divisão e
 * repasse continuam nascendo só quando o dinheiro entra.
 */
export async function createPaymentSchedule(ctx: ServiceContext, input: CreatePaymentScheduleInput): Promise<{ paymentIds: string[]; count: number; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const r = await repo.createPaymentSchedule(ctx.db, {
    key: input.idempotencyKey,
    agreementId: input.agreementId,
    total: input.total,
    installments: input.installments,
    firstDueDate: input.firstDueDate,
    frequency: input.frequency,
    paymentType: input.paymentType,
    description: input.description ?? null,
  });
  ctx.log.info(r.deduplicated ? "finance.schedule.deduplicated" : "finance.schedule.created", { agreementId: input.agreementId, count: r.count });
  return { paymentIds: r.payment_ids, count: r.count, deduplicated: r.deduplicated };
}

/** Corrige valor, vencimento ou descrição. Nunca o recebido (ledger). */
export async function updatePayment(ctx: ServiceContext, input: UpdatePaymentInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const balance = await repo.getPaymentBalance(ctx.db, input.id);
  if (!balance) throw notFound("Parcela não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Parcela cancelada não muda: registre outra.");
  if (input.patch.amount !== undefined && toCents(input.patch.amount) < toCents(balance.received_amount)) {
    throw businessRule("O valor da parcela não pode ficar abaixo do que já foi recebido.");
  }
  const values: Record<string, unknown> = {};
  if ("amount" in input.patch) values.amount = input.patch.amount;
  if ("dueDate" in input.patch) values.due_date = input.patch.dueDate ?? null;
  if ("description" in input.patch) values.description = input.patch.description ?? null;
  await repo.updateOpenPayment(ctx.db, input.id, values);
  ctx.log.info("finance.payment.updated", { paymentId: input.id });
}

/** Cancela a parcela (com motivo). Com recebimento líquido, estorne antes (o banco também recusa, 064: duas pessoas ao mesmo tempo não passam). */
export async function cancelPayment(ctx: ServiceContext, input: CancelPaymentInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const balance = await repo.getPaymentBalance(ctx.db, input.id);
  if (!balance) throw notFound("Parcela não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Parcela já cancelada.");
  if (toCents(balance.received_amount) > 0) throw businessRule("Estorne os recebimentos antes de cancelar a parcela.");
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
 * Extrato de recebimentos por período (064): cada lançamento do livro com o
 * cliente, o processo, a forma e o valor, e o TOTAL do período com os mesmos
 * filtros. Lista, filtros e soma no banco.
 */
export async function listReceiptStatement(ctx: ServiceContext, input: ListReceiptStatementInput): Promise<ReceiptStatementDTO> {
  requireFinance(ctx, "finance.view");
  const filters = receiptStatementFilters(input);
  const [list, totals] = await Promise.all([
    repo.listReceiptStatement(ctx.db, filters, input, { column: input.column, ascending: input.ascending }),
    repo.receiptStatementTotals(ctx.db, filters),
  ]);
  return { ...toPage(list.rows.map(receiptStatementItemFromRow), list.total, input), totals: receiptStatementTotalsFromRaw(totals) };
}

/** Filtros do extrato como o repositório espera (os mesmos na tela e na planilha). */
function receiptStatementFilters(input: ListReceiptStatementInput): repo.ReceiptStatementFilters {
  return { from: input.from, to: input.to, method: input.method, kind: input.kind, q: input.q };
}

/** Filtros do "a receber" como o repositório espera (os mesmos na tela e na planilha). */
function receivableFilters(input: ListReceivablesInput): repo.ReceivableFilters {
  return { from: input.from, to: input.to, overdueOnly: input.overdueOnly, q: input.q };
}

/**
 * "A receber" (064): parcelas em aberto com saldo, por vencimento, com o total
 * e a parte vencida dos mesmos filtros. Lista, filtros e soma no banco.
 */
export async function listReceivables(ctx: ServiceContext, input: ListReceivablesInput): Promise<ReceivablesDTO> {
  requireFinance(ctx, "finance.view");
  const filters = receivableFilters(input);
  const [list, totals] = await Promise.all([
    repo.listReceivables(ctx.db, filters, input, { column: input.column, ascending: input.ascending }),
    repo.receivablesTotals(ctx.db, filters),
  ]);
  return { ...toPage(list.rows.map(receivableFromRow), list.total, input), totals: receivablesTotalsFromRaw(totals) };
}

/**
 * Entrada (RECEIPT). Sem valor, quita o saldo (lido do banco). Exige contrato
 * ATIVO e parcela não cancelada. A divisão com o parceiro é gerada pelo
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
  if (!balance) throw notFound("Parcela não encontrada.");
  if (balance.status === "CANCELLED") throw invalidState("Parcela cancelada não recebe entrada.");
  const agreement = await repo.getAgreement(ctx.db, balance.financial_agreement_id);
  if (agreement?.status !== "ACTIVE") throw invalidState(ledgerBlockedMessage(agreement?.status, true));

  const balanceCents = toCents(balance.balance);
  const amountCents = input.amount !== undefined ? toCents(input.amount) : balanceCents;
  if (amountCents <= 0) throw invalidState("Esta parcela já está quitada.");
  if (amountCents > balanceCents) throw businessRule("O recebimento passa do saldo da parcela. Corrija a parcela antes.");

  const result = await repo.insertIdempotent(
    ctx.db,
    "payment_receipts",
    {
      payment_id: input.paymentId,
      kind: "RECEIPT",
      amount: fromCents(amountCents),
      currency: balance.currency,
      ...(input.occurredAt ? { occurred_at: pastInstant(input.occurredAt) } : {}),
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
 * Ajuste com justificativa (INCREASE soma, DECREASE subtrai). Todo lançamento
 * exige contrato ATIVO (064: concluído ou cancelado precisa ser reaberto
 * antes). Ajuste para MENOS é a correção de um recebimento: o original é
 * obrigatório (mesma parcela), para a parte do parceiro sair da mesma divisão.
 */
export async function registerAdjustment(ctx: ServiceContext, input: RegisterAdjustmentInput): Promise<ReceiptResultDTO> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payment_receipts", actorId, input.idempotencyKey);
  if (existing) return { receiptId: existing, deduplicated: true };

  const balance = await repo.getPaymentBalance(ctx.db, input.paymentId);
  if (!balance) throw notFound("Parcela não encontrada.");
  const increase = input.direction === "INCREASE";
  if (increase && balance.status === "CANCELLED") throw invalidState("Parcela cancelada não recebe entrada.");
  const agreement = await repo.getAgreement(ctx.db, balance.financial_agreement_id);
  if (agreement?.status !== "ACTIVE") throw invalidState(ledgerBlockedMessage(agreement?.status, increase));
  // O schema já exige; conferido de novo aqui porque o service também é chamado sem a Server Action.
  if (!increase && !input.originalReceiptId) throw validation({ originalReceiptId: ["Escolha o recebimento que este ajuste corrige."] });
  if (input.originalReceiptId) {
    const original = await repo.getReceipt(ctx.db, input.originalReceiptId);
    if (!original || original.payment_id !== input.paymentId) throw validation({ originalReceiptId: ["O recebimento escolhido não é desta parcela."] });
    if (toCents(original.amount) <= 0) throw validation({ originalReceiptId: ["Só se ajusta lançamento de entrada."] });
    if (!increase) {
      const reversedCents = (await repo.reversedAmountOf(ctx.db, original.id)).reduce((sum, v) => sum + toCents(v), 0);
      if (toCents(input.amount) > toCents(original.amount) + reversedCents) throw businessRule("O ajuste passa do que resta do recebimento escolhido.");
    }
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
      ...(input.occurredAt ? { occurred_at: pastInstant(input.occurredAt) } : {}),
    },
    actorId,
    input.idempotencyKey,
  );
  if (!result.deduplicated) ctx.log.info("finance.receipt.registered", { receiptId: result.id, paymentId: input.paymentId, kind: "ADJUSTMENT" });
  return { receiptId: result.id, deduplicated: result.deduplicated };
}

/**
 * Estorno de um lançamento de entrada. A parcela e a moeda vêm do original
 * (nunca do navegador). Sem valor, estorna o que resta do original. A divisão
 * inversa é gerada pelo banco no MESMO acordo de parceria do original. Exige
 * contrato ATIVO (064): depois de concluir ou cancelar, reabra o contrato.
 */
export async function registerReversal(ctx: ServiceContext, input: RegisterReversalInput): Promise<ReceiptResultDTO> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "payment_receipts", actorId, input.idempotencyKey);
  if (existing) return { receiptId: existing, deduplicated: true };

  const original = await repo.getReceipt(ctx.db, input.originalReceiptId);
  if (!original) throw notFound("Lançamento não encontrado.");
  if (toCents(original.amount) <= 0) throw invalidState("Só se estorna lançamento de entrada.");
  const balance = await repo.getPaymentBalance(ctx.db, original.payment_id);
  const agreement = balance ? await repo.getAgreement(ctx.db, balance.financial_agreement_id) : null;
  if (agreement?.status !== "ACTIVE") throw invalidState(ledgerBlockedMessage(agreement?.status, false));

  const reversedCents = (await repo.reversedAmountOf(ctx.db, original.id)).reduce((sum, v) => sum + toCents(v), 0);
  const remainingCents = toCents(original.amount) + reversedCents;
  if (remainingCents <= 0) throw invalidState("Este lançamento já foi estornado integralmente.");
  const amountCents = input.amount !== undefined ? toCents(input.amount) : remainingCents;
  if (amountCents > remainingCents) throw businessRule("O estorno passa do valor que resta do lançamento.");

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
      ...(input.occurredAt ? { occurred_at: pastInstant(input.occurredAt) } : {}),
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
 * 026 e 064): o limite é o saldo LÍQUIDO do parceiro, contando as divisões
 * negativas (dinheiro repassado de um recebimento depois estornado); consome
 * as divisões com saldo, mais antigas primeiro e travadas. Dois repasses
 * simultâneos não usam o mesmo saldo.
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
    if (error instanceof DomainError && error.code === "INVALID_STATE") {
      throw businessRule("O valor passa do saldo disponível do parceiro. O saldo já desconta o que foi repassado de recebimentos depois estornados.");
    }
    throw error;
  }
}

export async function markTransferPaid(ctx: ServiceContext, input: MarkTransferPaidInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getTransfer(ctx.db, input.id);
  if (!row) throw notFound("Repasse não encontrado.");
  if (row.status === "PAID") return;
  if (row.status !== "PENDING") throw invalidState("Só repasse pendente pode ser marcado como pago.");
  const values: Record<string, unknown> = { status: "PAID", paid_at: pastInstant(input.paidAt) ?? new Date().toISOString() };
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
    const ids = rows.map((r) => r.id);
    const [balances, totals] = ids.length
      ? await Promise.all([repo.listAllocationBalances(ctx.db, { partnerOrganizationId: org, agreementIds: ids }), repo.listShareTotals(ctx.db, ids)])
      : [[], []];
    return toPage(
      rows.map((r) => agreementShareFromRows(r, balances, totals)),
      total,
      input,
    );
  });
}

/**
 * "Valores da parceria" de um caso (4.3.1) — SÓ LEITURA: percentual congelado,
 * receita elegível, participação calculada, repassado, em repasse, saldo e o
 * histórico de repasses do caso. Tudo derivado do banco; nada se digita.
 * Parceiro: só PARTNER_ADMIN e só o próprio escritório (a RLS esconde o resto
 * — "não encontrado"). Interno: ADMIN, com a parte do escritório e o recebido
 * no caso inteiro.
 */
export async function getPartnerShareDetail(ctx: ServiceContext, input: { agreementId: string }): Promise<PartnerShareDetailDTO> {
  const partner = isPartner(ctx);
  if (partner) requirePermission(ctx, "partnerPortal.finance.view");
  else requireFinance(ctx, "finance.view");
  return partnerSafe(ctx, async () => {
    const agreement = await repo.getPartnershipById(ctx.db, input.agreementId);
    if (!agreement || (partner && agreement.partner_organization_id !== ctx.session.organizationId)) throw notFound("Parceria não encontrada.");
    const [balances, totals, items, received] = await Promise.all([
      repo.listAllocationBalances(ctx.db, { partnerOrganizationId: agreement.partner_organization_id, agreementIds: [agreement.id] }),
      repo.listShareTotals(ctx.db, [agreement.id]),
      repo.listShareTransferItems(ctx.db, agreement.id),
      partner ? Promise.resolve(undefined) : repo.caseReceived(ctx.db, agreement.legal_case_id),
    ]);
    const share = agreementShareFromRows(agreement, balances, totals);
    return {
      share,
      ownerPercentage: Number(agreement.owner_percentage),
      ownerShare: partner ? undefined : totals[0] ? Math.round(Number(totals[0].owner_share) * 100) / 100 : 0,
      caseReceived: received,
      transfers: shareTransfersFromRows(items),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Financeiro por processo (Roadmap 2.0, 046) — só ADMIN               */
/* ------------------------------------------------------------------ */

/**
 * Visão por processo: uma linha por processo, somada NO BANCO (view
 * process_finance_overview). Busca por cliente/título/CNJ; filtros "com
 * atraso", "com despesas a pagar", "sem contrato"; ordenação por whitelist.
 */
export async function listProcessFinance(ctx: ServiceContext, input: ListProcessFinanceInput): Promise<Page<ProcessFinanceDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listProcessFinance(ctx.db, processFinanceFilters(input), input, { column: input.column, ascending: input.ascending });
  return toPage(rows.map(processFinanceFromRow), total, input);
}

/** Filtros da visão por processo como o repositório espera (os mesmos na tela e na planilha). */
function processFinanceFilters(input: ListProcessFinanceInput): repo.ProcessFinanceFilters {
  return { q: input.q, legalCaseId: input.legalCaseId, overdueOnly: input.overdueOnly, openExpensesOnly: input.openExpensesOnly, withoutAgreement: input.withoutAgreement };
}

/** Primeira página dos contratos e das despesas do processo (o painel pagina depois pelas listagens). */
const DETAIL_PAGE = { page: 1, pageSize: 25 } as const;

/** Financeiro de UM processo: linha consolidada + contratos do processo + despesas. */
export async function getProcessFinance(ctx: ServiceContext, processId: string): Promise<ProcessFinanceDetailDTO> {
  requireFinance(ctx, "finance.view");
  const [row, agreements, expenses] = await Promise.all([
    repo.getProcessFinance(ctx.db, processId),
    listAgreementRows(ctx, { legalProcessId: processId, ...DETAIL_PAGE, column: "created_at", ascending: false }),
    listExpenses(ctx, { processId, ...DETAIL_PAGE, column: "incurred_on", ascending: false }),
  ]);
  if (!row) throw notFound("Processo não encontrado.");
  return { process: processFinanceFromRow(row), agreements, expenses };
}

/** Totais do escritório (view process_finance_totals, uma linha). */
export async function getProcessFinanceTotals(ctx: ServiceContext): Promise<ProcessFinanceTotalsDTO> {
  requireFinance(ctx, "finance.view");
  return processFinanceTotalsFromRow(await repo.getProcessFinanceTotals(ctx.db));
}

/** Despesas: todas (com rótulos do processo) ou de um processo; filtros por categoria, situação e período (data da despesa). */
export async function listExpenses(ctx: ServiceContext, input: ListExpensesInput): Promise<Page<ExpenseDTO>> {
  requireFinance(ctx, "finance.view");
  const { rows, total } = await repo.listExpenses(ctx.db, expenseFilters(input), input, { column: input.column, ascending: input.ascending }, !input.processId);
  return toPage(rows.map(expenseFromRow), total, input);
}

/** Filtros da lista de despesas como o repositório espera (os mesmos na tela e na planilha). */
function expenseFilters(input: ListExpensesInput): repo.ExpenseFilters {
  return { processId: input.processId, category: input.category, status: input.status, from: input.from, to: input.to };
}

/**
 * Nova despesa do processo (ADMIN). O caso vem do processo, lido aqui (o banco
 * também o sobrescreve); processo excluído ou sem acesso = recusado. Com chave
 * de idempotência (064): clique duplo ou reenvio devolve a despesa já lançada.
 */
export async function createExpense(ctx: ServiceContext, input: CreateExpenseInput): Promise<{ id: string; deduplicated: boolean }> {
  requireFinance(ctx, "finance.manage");
  const actorId = ctx.session.userId;
  const existing = await repo.findByIdempotencyKey(ctx.db, "process_expenses", actorId, input.idempotencyKey);
  if (existing) return { id: existing, deduplicated: true };
  const process = await repo.getProcessRef(ctx.db, input.processId);
  if (!process) throw validation({ processId: ["Processo não encontrado ou excluído."] }, "Processo não encontrado ou excluído.");
  const result = await repo.insertIdempotent(ctx.db, "process_expenses", expenseInsert(input, process.legal_case_id, actorId), actorId, input.idempotencyKey);
  if (!result.deduplicated) ctx.log.info("finance.expense.created", { expenseId: result.id, legalProcessId: process.id, category: input.category });
  return result;
}

/** Corrige a despesa ou marca como paga (`paidOn`). Cancelada é histórico: não muda. */
export async function updateExpense(ctx: ServiceContext, input: UpdateExpenseInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getExpense(ctx.db, input.id);
  if (!row) throw notFound("Despesa não encontrada.");
  if (row.cancelled_at) throw invalidState("Despesa cancelada é histórico: não muda.");
  await repo.updateActiveExpense(ctx.db, input.id, expenseUpdate(input.patch));
  ctx.log.info("finance.expense.updated", { expenseId: input.id, fields: Object.keys(input.patch).join(",") });
}

/** Cancela a despesa com motivo (nunca apaga). O banco grava quem cancelou. */
export async function cancelExpense(ctx: ServiceContext, input: CancelExpenseInput): Promise<void> {
  requireFinance(ctx, "finance.manage");
  const row = await repo.getExpense(ctx.db, input.id);
  if (!row) throw notFound("Despesa não encontrada.");
  if (row.cancelled_at) throw invalidState("Despesa já cancelada.");
  await repo.updateActiveExpense(ctx.db, input.id, { cancelled_at: new Date().toISOString(), cancellation_reason: input.reason });
  ctx.log.info("finance.expense.cancelled", { expenseId: input.id });
}

/**
 * Gráficos de despesas da visão geral (últimos 12 meses), agregados no SERVIDOR
 * sobre a lista de despesas ativas — volume do escritório cabe no teto de
 * leitura (`truncated` avisa se passar). Por categoria: pela data da despesa.
 * Por mês: pagas, pela data do pagamento (mesmo regime do "Recebido por mês").
 */
export async function getExpenseSummary(ctx: ServiceContext, now = new Date()): Promise<ExpenseSummaryDTO> {
  requireFinance(ctx, "finance.view");
  const months = lastMonths(now, 12);
  const fromDate = `${months[0]}-01`;
  const { rows, truncated } = await repo.activeExpensesSince(ctx.db, fromDate);
  if (truncated) ctx.log.warn("finance.expense_summary_truncated", {});
  return {
    byCategory: expensesByCategory(rows.filter((r) => r.incurred_on >= fromDate)),
    monthlyPaid: monthlyPaidExpenses(rows, months),
    truncated,
  };
}

/* ------------------------------------------------------------------ */
/* Planilhas do Financeiro (CSV) — só ADMIN                            */
/* ------------------------------------------------------------------ */

/**
 * As cinco listas do Financeiro saem em planilha com os MESMOS filtros e ordem
 * da tela (a entrada é a da listagem), até o limite de linhas. Quem exporta é
 * o ADMIN (`finance.view` + `data.export`; o banco confere de novo) e cada
 * exportação fica na auditoria ANTES de o arquivo sair: tipo da lista, filtros
 * (o texto da busca não é gravado) e quantidade de linhas, nunca o conteúdo.
 */
function requireFinanceExport(ctx: ServiceContext): void {
  requireFinance(ctx, "finance.view");
  requirePermission(ctx, "data.export");
}

/** Planilha de contratos de honorários. */
export async function exportAgreements(ctx: ServiceContext, input: ListAgreementRowsInput): Promise<ExportFileDTO> {
  requireFinanceExport(ctx);
  const filters = agreementRowFilters(input);
  const sort = { column: input.column, ascending: input.ascending };
  const { rows, total, truncated } = await collectForExport((page) => repo.listAgreementRows(ctx.db, filters, page, sort));
  return exportCsv(ctx, { kind: "finance_agreements", fileName: "contratos-de-honorarios", columns: AGREEMENT_EXPORT_COLUMNS, rows: rows.map(agreementListItemFromRow), filters: { ...filters }, total, truncated });
}

/** Planilha do "a receber": parcelas em aberto com saldo, por vencimento. */
export async function exportReceivables(ctx: ServiceContext, input: ListReceivablesInput): Promise<ExportFileDTO> {
  requireFinanceExport(ctx);
  const filters = receivableFilters(input);
  const sort = { column: input.column, ascending: input.ascending };
  const { rows, total, truncated } = await collectForExport((page) => repo.listReceivables(ctx.db, filters, page, sort));
  return exportCsv(ctx, { kind: "finance_receivables", fileName: "a-receber", columns: RECEIVABLE_EXPORT_COLUMNS, rows: rows.map(receivableFromRow), filters: { ...filters }, total, truncated });
}

/**
 * Planilha do extrato de recebimentos, com a parte do escritório e a do
 * parceiro em cada lançamento (a divisão que o banco gravou; sem parceria,
 * tudo é do escritório).
 */
export async function exportReceiptStatement(ctx: ServiceContext, input: ListReceiptStatementInput): Promise<ExportFileDTO> {
  requireFinanceExport(ctx);
  const filters = receiptStatementFilters(input);
  const sort = { column: input.column, ascending: input.ascending };
  const { rows, total, truncated } = await collectForExport((page) => repo.listReceiptStatement(ctx.db, filters, page, sort));
  const items = rows.map(receiptStatementItemFromRow);
  // Divisões em blocos de 100 lançamentos (os ids vão na URL da consulta).
  const [shares, organizations] = await Promise.all([
    mapChunks(
      items.map((i) => i.receiptId),
      100,
      (ids) => repo.listReceiptShares(ctx.db, ids),
    ),
    repo.listOrganizationNames(ctx.db),
  ]);
  return exportCsv(ctx, {
    kind: "finance_receipts",
    fileName: "recebimentos",
    columns: RECEIPT_EXPORT_COLUMNS,
    rows: withReceiptShares(items, shares, organizations),
    filters: { ...filters },
    total,
    truncated,
  });
}

/** Planilha de despesas, sempre com o cliente e o processo de cada uma. */
export async function exportExpenses(ctx: ServiceContext, input: ListExpensesInput): Promise<ExportFileDTO> {
  requireFinanceExport(ctx);
  const filters = expenseFilters(input);
  const sort = { column: input.column, ascending: input.ascending };
  const { rows, total, truncated } = await collectForExport((page) => repo.listExpenses(ctx.db, filters, page, sort, true));
  return exportCsv(ctx, { kind: "finance_expenses", fileName: "despesas", columns: EXPENSE_EXPORT_COLUMNS, rows: rows.map(expenseFromRow), filters: { ...filters }, total, truncated });
}

/** Planilha do financeiro por processo, com o nome do parceiro do caso. */
export async function exportProcessFinance(ctx: ServiceContext, input: ListProcessFinanceInput): Promise<ExportFileDTO> {
  requireFinanceExport(ctx);
  const filters = processFinanceFilters(input);
  const sort = { column: input.column, ascending: input.ascending };
  const [{ rows, total, truncated }, organizations] = await Promise.all([
    collectForExport((page) => repo.listProcessFinance(ctx.db, filters, page, sort)),
    repo.listOrganizationNames(ctx.db),
  ]);
  const exportRows: ProcessFinanceExportRow[] = rows.map((row) => {
    const item = processFinanceFromRow(row);
    return { ...item, partnerName: item.partnerOrganizationId ? organizations.get(item.partnerOrganizationId) : undefined };
  });
  return exportCsv(ctx, { kind: "finance_processes", fileName: "financeiro-por-processo", columns: PROCESS_FINANCE_EXPORT_COLUMNS, rows: exportRows, filters: { ...filters }, total, truncated });
}
