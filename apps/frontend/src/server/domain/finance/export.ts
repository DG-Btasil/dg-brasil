import { PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL } from "@/lib/constants/status";
import { formatCNJ } from "@/lib/formatting/masks";
import {
  AGREEMENT_DB_STATUS_LABEL,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_STATUS_LABEL,
  PAYMENT_DB_STATUS_LABEL,
  PAYMENT_TYPE_LABEL,
  RECEIPT_KIND_LABEL,
  RECEIPT_METHOD_LABEL,
} from "@/features/finance/labels";
import { csvDate, csvMoney, csvNumber, type CsvColumn } from "@/server/domain/exports/csv";
import type { AgreementListItemDTO, ExpenseDTO, ProcessFinanceDTO, ReceiptStatementItemDTO, ReceivableItemDTO } from "./dto";

/**
 * Colunas das planilhas do Financeiro (só ADMIN): contratos, a receber,
 * recebimentos, despesas e por processo. Puro e testado (export.test.ts).
 *
 * Valores em reais com vírgula e sem "R$" (o Excel soma), datas dd/mm/aaaa e
 * número CNJ com máscara. Os rótulos são os mesmos da tela.
 */

const cnj = (digits: string | undefined) => (digits ? formatCNJ(digits) : "");
const percent = (value: number | undefined) => (value === undefined ? "" : csvNumber(value));

/* ------------------------------------------------------------------ */
/* Contratos de honorários                                             */
/* ------------------------------------------------------------------ */

export const AGREEMENT_EXPORT_COLUMNS: readonly CsvColumn<AgreementListItemDTO>[] = [
  { header: "Cliente", value: (a) => a.clientName },
  { header: "Caso", value: (a) => a.caseTitle },
  { header: "Processo", value: (a) => a.processTitle },
  { header: "Número CNJ", value: (a) => cnj(a.cnjNumber) },
  { header: "Modelo de honorários", value: (a) => a.feeModelName ?? "Valores próprios" },
  { header: "Situação", value: (a) => AGREEMENT_DB_STATUS_LABEL[a.status] },
  // A mesma data do filtro "Data do contrato": o início ou, sem início, o dia do cadastro.
  { header: "Data do contrato", value: (a) => csvDate(a.startDate ?? a.createdAt) },
  { header: "Entrada", value: (a) => csvMoney(a.upfrontFee) },
  { header: "Valor fixo", value: (a) => csvMoney(a.fixedFee) },
  { header: "Parcelas", value: (a) => a.installments },
  { header: "Mensalidade", value: (a) => csvMoney(a.monthlyFee) },
  { header: "Êxito (%)", value: (a) => percent(a.successFeePercent) },
  { header: "Contratado", value: (a) => csvMoney(a.totals.contracted) },
  { header: "Recebido", value: (a) => csvMoney(a.totals.received) },
  { header: "Em aberto", value: (a) => csvMoney(a.totals.outstanding) },
  { header: "Em atraso", value: (a) => csvMoney(a.totals.overdue) },
  { header: "Parcelas em aberto", value: (a) => a.totals.openPayments },
  { header: "Próximo vencimento", value: (a) => csvDate(a.nextDueDate) },
  { header: "Nos totais por processo", value: (a) => a.inProcessTotals },
];

/* ------------------------------------------------------------------ */
/* A receber                                                           */
/* ------------------------------------------------------------------ */

export const RECEIVABLE_EXPORT_COLUMNS: readonly CsvColumn<ReceivableItemDTO>[] = [
  { header: "Vencimento", value: (r) => csvDate(r.dueDate) },
  { header: "Cliente", value: (r) => r.clientName },
  { header: "Caso", value: (r) => r.caseTitle },
  { header: "Processo", value: (r) => r.processTitle },
  { header: "Número CNJ", value: (r) => cnj(r.cnjNumber) },
  { header: "Parcela", value: (r) => PAYMENT_TYPE_LABEL[r.paymentType] },
  { header: "Descrição", value: (r) => r.description },
  { header: "Valor da parcela", value: (r) => csvMoney(r.amount) },
  { header: "Recebido", value: (r) => csvMoney(r.receivedAmount) },
  { header: "Saldo a receber", value: (r) => csvMoney(r.balance) },
  { header: "Situação", value: (r) => PAYMENT_DB_STATUS_LABEL[r.status] },
  { header: "Dias de atraso", value: (r) => r.daysOverdue },
  { header: "Situação do contrato", value: (r) => AGREEMENT_DB_STATUS_LABEL[r.agreementStatus] },
  { header: "Nos totais por processo", value: (r) => r.inProcessTotals },
];

/* ------------------------------------------------------------------ */
/* Recebimentos (extrato)                                              */
/* ------------------------------------------------------------------ */

/** Linha do extrato + a divisão com o parceiro (quando o caso tem parceria). */
export interface ReceiptExportRow extends ReceiptStatementItemDTO {
  partnerName?: string;
  /** Parte do parceiro neste lançamento (com sinal); zero quando não há parceria. */
  partnerAmount: number;
  /** Parte do escritório: o valor do lançamento menos a parte do parceiro. */
  ownerAmount: number;
}

/** Divisão de um lançamento como o banco gravou (partner_revenue_allocations). */
export interface ReceiptShareRow {
  receipt_id: string;
  partner_amount: number | string;
  case_partnership_agreements: { partner_organization_id: string } | { partner_organization_id: string }[] | null;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Junta cada lançamento com a sua divisão. A parte do parceiro é a que o BANCO
 * calculou na hora do lançamento (percentual congelado); aqui só se soma por
 * lançamento. Sem divisão (caso sem parceria), tudo é do escritório.
 */
export function withReceiptShares(items: readonly ReceiptStatementItemDTO[], shares: readonly ReceiptShareRow[], organizationNames: ReadonlyMap<string, string>): ReceiptExportRow[] {
  const byReceipt = new Map<string, { partner: number; organizationId?: string }>();
  for (const share of shares) {
    const embedded = Array.isArray(share.case_partnership_agreements) ? share.case_partnership_agreements[0] : share.case_partnership_agreements;
    const current = byReceipt.get(share.receipt_id) ?? { partner: 0 };
    byReceipt.set(share.receipt_id, { partner: current.partner + Number(share.partner_amount), organizationId: current.organizationId ?? embedded?.partner_organization_id });
  }
  return items.map((item) => {
    const share = byReceipt.get(item.receiptId);
    const partnerAmount = cents(share?.partner ?? 0);
    return {
      ...item,
      partnerName: share?.organizationId ? organizationNames.get(share.organizationId) : undefined,
      partnerAmount,
      ownerAmount: cents(item.amount - partnerAmount),
    };
  });
}

const methodLabel = (method: string | undefined) => (method ? ((RECEIPT_METHOD_LABEL as Record<string, string>)[method] ?? method) : "");

export const RECEIPT_EXPORT_COLUMNS: readonly CsvColumn<ReceiptExportRow>[] = [
  { header: "Data", value: (r) => csvDate(r.occurredOn) },
  { header: "Lançamento", value: (r) => r.sequence },
  { header: "Tipo", value: (r) => RECEIPT_KIND_LABEL[r.kind] },
  { header: "Cliente", value: (r) => r.clientName },
  { header: "Caso", value: (r) => r.caseTitle },
  { header: "Processo", value: (r) => r.processTitle },
  { header: "Número CNJ", value: (r) => cnj(r.cnjNumber) },
  { header: "Parcela", value: (r) => PAYMENT_TYPE_LABEL[r.paymentType] },
  { header: "Descrição da parcela", value: (r) => r.paymentDescription },
  { header: "Forma de recebimento", value: (r) => methodLabel(r.method) },
  // Com sinal: estorno e ajuste para menos saem negativos, como no extrato.
  { header: "Valor", value: (r) => csvMoney(r.amount) },
  { header: "Parte do escritório", value: (r) => csvMoney(r.ownerAmount) },
  { header: "Parte do parceiro", value: (r) => csvMoney(r.partnerAmount) },
  { header: "Parceiro", value: (r) => r.partnerName },
  { header: "Observação", value: (r) => r.notes },
];

/* ------------------------------------------------------------------ */
/* Despesas                                                            */
/* ------------------------------------------------------------------ */

export const EXPENSE_EXPORT_COLUMNS: readonly CsvColumn<ExpenseDTO>[] = [
  { header: "Data da despesa", value: (e) => csvDate(e.incurredOn) },
  { header: "Cliente", value: (e) => e.clientName },
  { header: "Processo", value: (e) => e.processTitle },
  { header: "Número CNJ", value: (e) => cnj(e.cnjNumber) },
  { header: "Categoria", value: (e) => EXPENSE_CATEGORY_LABEL[e.category] },
  { header: "Descrição", value: (e) => e.description },
  { header: "Fornecedor", value: (e) => e.supplier },
  { header: "Valor", value: (e) => csvMoney(e.amount) },
  { header: "Situação", value: (e) => EXPENSE_STATUS_LABEL[e.status] },
  { header: "Paga em", value: (e) => csvDate(e.paidOn) },
  { header: "Reembolsável", value: (e) => e.reimbursable },
  { header: "Observações", value: (e) => e.notes },
  { header: "Cancelada em", value: (e) => csvDate(e.cancelledAt) },
  { header: "Motivo do cancelamento", value: (e) => e.cancellationReason },
];

/* ------------------------------------------------------------------ */
/* Financeiro por processo                                             */
/* ------------------------------------------------------------------ */

/** Linha da visão por processo + o nome do parceiro do caso. */
export interface ProcessFinanceExportRow extends ProcessFinanceDTO {
  partnerName?: string;
}

export const PROCESS_FINANCE_EXPORT_COLUMNS: readonly CsvColumn<ProcessFinanceExportRow>[] = [
  { header: "Cliente", value: (p) => p.clientName },
  { header: "Processo", value: (p) => p.title },
  { header: "Número CNJ", value: (p) => cnj(p.cnjNumber) },
  { header: "Caso", value: (p) => p.caseTitle },
  { header: "Situação", value: (p) => PROCESS_STATUS_LABEL[p.status] },
  { header: "Fase", value: (p) => (p.phase ? PROCESS_PHASE_LABEL[p.phase] : "") },
  { header: "Valor da causa", value: (p) => csvMoney(p.caseValue) },
  { header: "Honorários", value: (p) => csvMoney(p.feeAmount) },
  { header: "Honorários (%)", value: (p) => percent(p.feePercentage) },
  { header: "Parceiro", value: (p) => p.partnerName },
  { header: "Parceiro (%)", value: (p) => (p.partnerOrganizationId ? percent(p.partnerPercentage) : "") },
  { header: "Honorários: parte do escritório", value: (p) => csvMoney(p.feeOwnerShare) },
  { header: "Honorários: parte do parceiro", value: (p) => csvMoney(p.feePartnerShare) },
  { header: "Contratado", value: (p) => csvMoney(p.contracted) },
  { header: "Recebido", value: (p) => csvMoney(p.received) },
  { header: "Recebido: parte do escritório", value: (p) => csvMoney(p.receivedOwnerShare) },
  { header: "Recebido: parte do parceiro", value: (p) => csvMoney(p.receivedPartnerShare) },
  { header: "Em aberto", value: (p) => csvMoney(p.openBalance) },
  { header: "Em atraso", value: (p) => csvMoney(p.overdue) },
  { header: "Contratos", value: (p) => p.agreementCount },
  { header: "Despesas", value: (p) => csvMoney(p.expensesTotal) },
  { header: "Despesas pagas", value: (p) => csvMoney(p.expensesPaid) },
  { header: "Despesas a pagar", value: (p) => csvMoney(p.expensesOpen) },
  { header: "Despesas reembolsáveis", value: (p) => csvMoney(p.expensesReimbursable) },
  { header: "Resultado", value: (p) => csvMoney(p.netResult) },
];
