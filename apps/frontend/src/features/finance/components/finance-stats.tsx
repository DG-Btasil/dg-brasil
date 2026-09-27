import { CircleAlert, HandCoins, TrendingUp, Wallet } from "lucide-react";
import { Stat } from "@/components/ui/display";
import { formatCurrency, pluralize } from "@/lib/formatting";
import type { AgreementRow } from "../utils";

export interface FinanceTotals {
  receivable: number;
  received: number;
  receivedThisMonth: number;
  overdue: number;
  overdueAgreements: number;
  estimatedSuccess: number;
  successAgreements: number;
}

export function computeTotals(rows: AgreementRow[], today: string): FinanceTotals {
  const month = today.slice(0, 7);
  const active = rows.filter((r) => r.agreement.status !== "CANCELLED");
  const payments = active.flatMap((r) => r.payments);
  const withSuccess = active.filter((r) => r.agreement.estimatedSuccessFee);
  return {
    receivable: payments.filter((p) => p.status !== "PAID").reduce((s, p) => s + p.amount, 0),
    received: payments.filter((p) => p.status === "PAID").reduce((s, p) => s + p.amount, 0),
    receivedThisMonth: payments.filter((p) => p.status === "PAID" && (p.paidAt ?? "").slice(0, 7) === month).reduce((s, p) => s + p.amount, 0),
    overdue: payments.filter((p) => p.status === "OVERDUE").reduce((s, p) => s + p.amount, 0),
    overdueAgreements: active.filter((r) => r.overdueAmount > 0).length,
    estimatedSuccess: withSuccess.reduce((s, r) => s + (r.agreement.estimatedSuccessFee ?? 0), 0),
    successAgreements: withSuccess.length,
  };
}

export function FinanceStats({ totals }: { totals: FinanceTotals }) {
  return (
    <div className="grid grid-cols-4 gap-4">
      <Stat label="A receber" value={formatCurrency(totals.receivable)} icon={Wallet} hint="Parcelas a vencer e em atraso" />
      <Stat label="Recebido" value={formatCurrency(totals.received)} icon={HandCoins} tone="success" hint={`${formatCurrency(totals.receivedThisMonth)} no mês`} />
      <Stat
        label="Em atraso"
        value={formatCurrency(totals.overdue)}
        icon={CircleAlert}
        tone={totals.overdue > 0 ? "danger" : "neutral"}
        hint={totals.overdueAgreements > 0 ? `${pluralize(totals.overdueAgreements, "contrato", "contratos")} com parcela vencida` : "Nenhuma parcela vencida"}
      />
      <Stat
        label="Êxito previsto"
        value={formatCurrency(totals.estimatedSuccess)}
        icon={TrendingUp}
        tone="gold"
        hint={`Estimativa sobre o valor da causa · ${pluralize(totals.successAgreements, "contrato", "contratos")}`}
      />
    </div>
  );
}
