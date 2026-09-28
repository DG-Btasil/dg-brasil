/**
 * Regra central do financeiro. ÚNICO lugar que decide status de parcela e de
 * contrato. Nada disso é gravado: tudo é derivado dos fatos (valor devido,
 * valor pago, vencimento, cancelamento). Assim, registrar ou alterar um
 * pagamento atualiza, na mesma leitura, a parcela, o contrato, a tabela
 * geral, os KPIs e a Home.
 *
 * O backend deve aplicar exatamente estas regras (ver docs/BACKEND_HANDOFF.md).
 */
import { todayISO } from "@/lib/clock";
import type { AgreementStatus, PaymentStatus } from "@/lib/constants/status";
import type { AgreementSummary, AgreementView, FinancialAgreement, Payment, PaymentView } from "@/types";

/** Tolerância para arredondamento de centavos. */
const EPSILON = 0.005;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Saldo restante da parcela (nunca negativo). */
export function paymentBalance(payment: Payment): number {
  return Math.max(0, roundMoney(payment.amount - (payment.paidAmount ?? 0)));
}

/**
 * Status da parcela:
 * - saldo = 0                    → PAID
 * - saldo > 0 e vencida          → OVERDUE
 * - saldo > 0, algo já pago      → PARTIALLY_PAID
 * - saldo > 0, nada pago         → PENDING
 */
export function paymentStatus(payment: Payment, today: string = todayISO()): PaymentStatus {
  const balance = paymentBalance(payment);
  if (balance <= EPSILON) return "PAID";
  if (payment.dueDate < today) return "OVERDUE";
  if ((payment.paidAmount ?? 0) > EPSILON) return "PARTIALLY_PAID";
  return "PENDING";
}

export function toPaymentView(payment: Payment, today: string = todayISO()): PaymentView {
  return { ...payment, status: paymentStatus(payment, today), balance: paymentBalance(payment) };
}

/**
 * Status do contrato:
 * - cancelado manualmente                         → CANCELLED
 * - alguma parcela em atraso                      → OVERDUE
 * - todas quitadas (e sem mensalidade recorrente) → SETTLED
 * - demais casos                                  → ACTIVE ("Em dia")
 */
export function agreementStatus(agreement: FinancialAgreement, payments: Payment[], today: string = todayISO()): AgreementStatus {
  if (agreement.cancelledAt) return "CANCELLED";
  const own = payments.filter((p) => p.agreementId === agreement.id);
  const statuses = own.map((p) => paymentStatus(p, today));
  if (statuses.includes("OVERDUE")) return "OVERDUE";
  if (own.length > 0 && statuses.every((s) => s === "PAID") && !agreement.monthlyFee) return "SETTLED";
  return "ACTIVE";
}

export function toAgreementView(agreement: FinancialAgreement, payments: Payment[], today: string = todayISO()): AgreementView {
  return { ...agreement, status: agreementStatus(agreement, payments, today) };
}

/** Totais do contrato, todos a partir das parcelas. */
export function summarizeAgreement(agreement: FinancialAgreement, payments: Payment[], today: string = todayISO()): AgreementSummary {
  const own = payments.filter((p) => p.agreementId === agreement.id).map((p) => toPaymentView(p, today));
  const received = roundMoney(own.reduce((s, p) => s + (p.paidAmount ?? 0), 0));
  const overdueAmount = roundMoney(own.filter((p) => p.status === "OVERDUE").reduce((s, p) => s + p.balance, 0));
  const open = own.filter((p) => p.status !== "PAID");
  const outstandingBalance = roundMoney(open.reduce((s, p) => s + p.balance, 0));
  const nextDueDate = open.map((p) => p.dueDate).sort()[0];
  return { agreement: toAgreementView(agreement, payments, today), received, outstandingBalance, overdueAmount, nextDueDate };
}

/** Parcela com saldo em aberto cujo vencimento já passou. */
export function isPastDue(payment: Payment, today: string = todayISO()): boolean {
  return paymentStatus(payment, today) === "OVERDUE";
}
