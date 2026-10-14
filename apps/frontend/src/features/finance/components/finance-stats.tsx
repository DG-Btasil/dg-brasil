import { CircleAlert, FileSignature, HandCoins, Wallet } from "lucide-react";
import { Stat } from "@/components/ui/display";
import { formatCurrency, pluralize } from "@/lib/formatting";
import type { FinanceSummaryDTO } from "@/server/domain/finance/dto";

/** Totais da visão geral — somados no servidor sobre o que o banco derivou (view payment_balances). */
export function FinanceStats({ summary }: { summary: FinanceSummaryDTO }) {
  const { totals, agreementsByStatus } = summary;
  return (
    <div className="grid grid-cols-4 gap-4">
      <Stat label="Em aberto" value={formatCurrency(totals.outstanding)} icon={Wallet} hint={`${pluralize(totals.openPayments, "obrigação", "obrigações")} a receber`} />
      <Stat label="Recebido" value={formatCurrency(totals.received)} icon={HandCoins} tone="success" hint={`De ${formatCurrency(totals.contracted)} contratados`} />
      <Stat
        label="Em atraso"
        value={formatCurrency(totals.overdue)}
        icon={CircleAlert}
        tone={totals.overdue > 0 ? "danger" : "neutral"}
        hint={totals.overdue > 0 ? "Obrigações vencidas com saldo" : "Nenhuma obrigação vencida"}
      />
      <Stat
        label="Contratos ativos"
        value={String(agreementsByStatus.ACTIVE)}
        icon={FileSignature}
        tone="gold"
        hint={`${pluralize(agreementsByStatus.DRAFT, "rascunho", "rascunhos")} · ${pluralize(agreementsByStatus.COMPLETED, "concluído", "concluídos")}`}
      />
    </div>
  );
}
