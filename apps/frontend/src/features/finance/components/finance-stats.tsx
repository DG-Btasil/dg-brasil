import { CircleAlert, FileSignature, HandCoins, Landmark, ReceiptText, Scale, Wallet, Briefcase } from "lucide-react";
import { Stat } from "@/components/ui/display";
import { formatCurrency, pluralize } from "@/lib/formatting";
import type { FinanceSummaryDTO, ProcessFinanceTotalsDTO } from "@/server/domain/finance/dto";

/**
 * Indicadores da visão geral. Com os totais por processo (046, somados no
 * banco: view process_finance_totals), mostra valor das ações, honorários
 * (escritório × parceiro), recebido, em aberto, atraso, despesas e resultado.
 * Sem eles (falha de leitura), cai nos totais do ledger (payment_balances).
 */
export function FinanceStats({ summary, totals }: { summary: FinanceSummaryDTO; totals?: ProcessFinanceTotalsDTO }) {
  const { agreementsByStatus } = summary;
  const contracts = (
    <Stat
      label="Contratos ativos"
      value={String(agreementsByStatus.ACTIVE)}
      icon={FileSignature}
      tone="gold"
      hint={`${pluralize(agreementsByStatus.DRAFT, "rascunho", "rascunhos")} · ${pluralize(agreementsByStatus.COMPLETED, "concluído", "concluídos")}`}
    />
  );
  if (!totals) {
    const t = summary.totals;
    return (
      <div className="grid grid-cols-4 gap-4">
        <Stat label="Em aberto" value={formatCurrency(t.outstanding)} icon={Wallet} hint={`${pluralize(t.openPayments, "obrigação", "obrigações")} a receber`} />
        <Stat label="Recebido" value={formatCurrency(t.received)} icon={HandCoins} tone="success" hint={`De ${formatCurrency(t.contracted)} contratados`} />
        <Stat
          label="Em atraso"
          value={formatCurrency(t.overdue)}
          icon={CircleAlert}
          tone={t.overdue > 0 ? "danger" : "neutral"}
          hint={t.overdue > 0 ? "Obrigações vencidas com saldo" : "Nenhuma obrigação vencida"}
        />
        {contracts}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-4 gap-4">
      <Stat label="Valor total das ações" value={formatCurrency(totals.caseValueTotal)} icon={Scale} hint={`Soma do valor da causa de ${pluralize(totals.processCount, "processo", "processos")}`} />
      <Stat
        label="Honorários previstos"
        value={formatCurrency(totals.feeTotal)}
        icon={Briefcase}
        tone="gold"
        hint={`Escritório ${formatCurrency(totals.feeOwnerTotal)} · parceiro ${formatCurrency(totals.feePartnerTotal)}`}
      />
      <Stat
        label="Recebido"
        value={formatCurrency(totals.receivedTotal)}
        icon={HandCoins}
        tone="success"
        hint={`Escritório ${formatCurrency(totals.receivedOwnerTotal)} · parceiro ${formatCurrency(totals.receivedPartnerTotal)}`}
      />
      <Stat
        label="Resultado"
        value={formatCurrency(totals.netResultTotal)}
        icon={Landmark}
        tone={totals.netResultTotal < 0 ? "danger" : "navy"}
        hint="Recebido do escritório − despesas pagas"
      />
      <Stat label="Em aberto" value={formatCurrency(totals.openTotal)} icon={Wallet} hint={`De ${formatCurrency(totals.contractedTotal)} contratados`} />
      <Stat
        label="Em atraso"
        value={formatCurrency(totals.overdueTotal)}
        icon={CircleAlert}
        tone={totals.overdueTotal > 0 ? "danger" : "neutral"}
        hint={totals.overdueTotal > 0 ? "Obrigações vencidas com saldo" : "Nenhuma obrigação vencida"}
      />
      <Stat
        label="Despesas"
        value={formatCurrency(totals.expensesTotal)}
        icon={ReceiptText}
        tone={totals.expensesOpenTotal > 0 ? "warning" : "neutral"}
        hint={`Pagas ${formatCurrency(totals.expensesPaidTotal)} · a pagar ${formatCurrency(totals.expensesOpenTotal)}`}
      />
      {contracts}
    </div>
  );
}
