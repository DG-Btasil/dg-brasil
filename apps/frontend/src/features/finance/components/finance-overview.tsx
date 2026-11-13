"use client";

import Link from "next/link";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout } from "@/components/feedback/states";
import type { ExpenseSummaryDTO, FinanceSummaryDTO, ProcessFinanceTotalsDTO, ReceivableAgingDTO } from "@/server/domain/finance/dto";
import { hasOutsideTotals, outsideTotalsNotice } from "../outside-totals";
import { CompositionChart, ExpensesByCategoryChart, MonthlyReceiptsChart, ReceivableAgingChart, ReceivedVsExpensesChart } from "./finance-charts";
import { FinanceStats } from "./finance-stats";

/**
 * Aba "Visão geral" do Financeiro (ADMIN): indicadores por processo (046) e
 * totais da visão geral (064), somados no banco de dados; recebido por mês,
 * gráficos de despesas e "A receber por vencimento". Nada é somado no
 * navegador. O que fica fora dos totais por processo (contrato antigo, só do
 * caso, ou de processo excluído) vem separado do servidor: o aviso daqui é o
 * mesmo da Home.
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
  const outside = summary.data.outside;
  return (
    <>
      {summary.data.truncated && (
        <Callout tone="warning" title="Totais parciais">
          O volume passou do limite de leitura da visão geral. As listas das outras abas continuam completas.
        </Callout>
      )}
      {!totals.ok && <ActionErrorState error={totals} title="Não foi possível carregar os totais por processo." />}
      <FinanceStats summary={summary.data} totals={t} />
      {hasOutsideTotals(outside) && (
        <Callout tone="info" title="Contratos fora dos totais">
          {outsideTotalsNotice(outside)} Veja-os na aba{" "}
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
          O volume de parcelas em aberto passou do limite de leitura do gráfico.
        </Callout>
      )}
    </>
  );
}
