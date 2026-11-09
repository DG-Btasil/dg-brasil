"use client";

import Link from "next/link";
import type { ActionResult } from "@/lib/actions/result";
import { formatCurrency } from "@/lib/formatting";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout } from "@/components/feedback/states";
import type { ExpenseSummaryDTO, FinanceSummaryDTO, ProcessFinanceTotalsDTO, ReceivableAgingDTO } from "@/server/domain/finance/dto";
import { CompositionChart, ExpensesByCategoryChart, MonthlyReceiptsChart, ReceivableAgingChart, ReceivedVsExpensesChart } from "./finance-charts";
import { FinanceStats } from "./finance-stats";

/**
 * Aba "Visão geral" do Financeiro (ADMIN): indicadores por processo (046,
 * somados no banco), recebido por mês (ledger), os gráficos de despesas e o
 * "A receber por vencimento" (agregados no servidor). Nada é somado no
 * navegador além de diferenças entre totais que o servidor já entregou.
 */
export function FinanceOverviewTab({
  summary,
  totals,
  expenses,
  aging,
}: {
  summary: ActionResult<FinanceSummaryDTO>;
  totals: ActionResult<ProcessFinanceTotalsDTO>;
  expenses: ActionResult<ExpenseSummaryDTO>;
  /** Saldo em aberto dos contratos de processo, por faixa de vencimento (E-06). */
  aging: ActionResult<ReceivableAgingDTO>;
}) {
  if (!summary.ok) return <ActionErrorState error={summary} title="Não foi possível carregar os totais." />;
  const t = totals.ok ? totals.data : undefined;
  // Contratos antigos (do caso, sem processo) entram no ledger geral mas não na visão por processo.
  const cents = (v: number) => Math.round(v * 100);
  const legacyReceived = t ? (cents(summary.data.totals.received) - cents(t.receivedTotal)) / 100 : 0;
  const legacyOpen = t ? (cents(summary.data.totals.outstanding) - cents(t.openTotal)) / 100 : 0;
  return (
    <>
      {summary.data.truncated && (
        <Callout tone="warning" title="Totais parciais">
          O volume passou do limite de leitura da visão geral. As listas das outras abas continuam completas.
        </Callout>
      )}
      {!totals.ok && <ActionErrorState error={totals} title="Não foi possível carregar os totais por processo." />}
      <FinanceStats summary={summary.data} totals={t} />
      {(legacyReceived > 0 || legacyOpen > 0) && (
        <Callout tone="info" title="Contratos antigos, do caso">
          {formatCurrency(legacyReceived)} recebidos e {formatCurrency(legacyOpen)} em aberto estão em contratos anteriores ao financeiro por processo (ligados só ao caso) e não entram nos
          totais acima. Veja-os na aba{" "}
          <Link href="/financeiro?aba=contratos" className="text-navy-700 underline underline-offset-2">
            Contratos
          </Link>
          .
        </Callout>
      )}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {expenses.ok ? <ReceivedVsExpensesChart received={summary.data.monthly} expenses={expenses.data.monthlyPaid} /> : <MonthlyReceiptsChart data={summary.data.monthly} />}
        {expenses.ok ? <ExpensesByCategoryChart data={expenses.data.byCategory} /> : <ActionErrorState error={expenses} title="Não foi possível carregar as despesas." />}
        <CompositionChart data={summary.data.byFeeModel} />
        {aging.ok ? <ReceivableAgingChart data={aging.data} /> : <ActionErrorState error={aging} title="Não foi possível carregar o a receber por vencimento." />}
      </div>
      {expenses.ok && expenses.data.truncated && (
        <Callout tone="warning" title="Gráficos de despesas parciais">
          O volume de despesas passou do limite de leitura dos gráficos.
        </Callout>
      )}
      {aging.ok && aging.data.truncated && (
        <Callout tone="warning" title="A receber por vencimento parcial">
          O volume de obrigações em aberto passou do limite de leitura do gráfico.
        </Callout>
      )}
    </>
  );
}
