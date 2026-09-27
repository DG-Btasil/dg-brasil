import { todayISO } from "@/lib/clock";
import type { AgreementStatus } from "@/lib/constants/status";
import type { AgreementSummary, FinancialAgreement, Payment } from "@/types";

export function summarizeAgreement(agreement: FinancialAgreement, payments: Payment[]): AgreementSummary {
  const own = payments.filter((p) => p.agreementId === agreement.id);
  const received = own.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0);
  const overdueAmount = own.filter((p) => p.status === "OVERDUE").reduce((s, p) => s + p.amount, 0);
  const open = own.filter((p) => p.status !== "PAID");
  const outstandingBalance = open.reduce((s, p) => s + p.amount, 0);
  const nextDueDate = open.map((p) => p.dueDate).sort()[0];
  return { agreement, received, outstandingBalance, overdueAmount, nextDueDate };
}

/** Status derivado dos pagamentos (usado após registrar pagamento). */
export function deriveAgreementStatus(agreement: FinancialAgreement, payments: Payment[]): AgreementStatus {
  if (agreement.status === "CANCELLED") return "CANCELLED";
  const own = payments.filter((p) => p.agreementId === agreement.id);
  if (own.some((p) => p.status === "OVERDUE")) return "OVERDUE";
  if (own.length > 0 && own.every((p) => p.status === "PAID") && !agreement.monthlyFee) return "SETTLED";
  return "ACTIVE";
}

/** Pagamento pendente cujo vencimento já passou. */
export function isPastDue(payment: Payment): boolean {
  return payment.status !== "PAID" && payment.dueDate < todayISO();
}
