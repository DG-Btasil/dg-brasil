import type { Metadata } from "next";
import { getDashboardMetricsAction } from "@/server/domain/metrics/actions";
import { loadAllPages } from "@/lib/actions/all-pages";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { AgreementsPanel } from "@/features/finance/components/agreements-table";
import { ExpensesPanel } from "@/features/finance/components/expenses-panel";
import { FeeModelsPanel } from "@/features/finance/components/fee-models-panel";
import { FinanceOverviewTab } from "@/features/finance/components/finance-overview";
import { FinanceWorkspace } from "@/features/finance/components/finance-workspace";
import { ProcessFinanceTable } from "@/features/finance/components/process-finance-table";
import { ReceiptStatementPanel } from "@/features/finance/components/receipt-statement-panel";
import { ReceivablesPanel } from "@/features/finance/components/receivables-panel";
import {
  agreementQueryFromSearchParams,
  agreementQueryToInput,
  expenseQueryFromSearchParams,
  expenseQueryToInput,
  financeTabFromSearchParams,
  processFinanceQueryFromSearchParams,
  processFinanceQueryToInput,
  receiptStatementQueryFromSearchParams,
  receiptStatementQueryToInput,
  receivableQueryFromSearchParams,
  receivableQueryToInput,
  type FinanceTab,
} from "@/features/finance/list-query";
import { PortalFinance } from "@/features/partner-portal/components/portal-finance";
import { getCaseCatalogAction } from "@/server/domain/cases/actions";
import {
  getExpenseSummaryAction,
  getFinanceSummaryAction,
  getMyPartnerFinanceAction,
  getProcessFinanceTotalsAction,
  getReceivableAgingAction,
  listAgreementRowsAction,
  listExpensesAction,
  listFeeModelsAction,
  listPartnerAgreementSharesAction,
  listProcessFinanceAction,
  listReceiptStatementAction,
  listReceivablesAction,
  listTransfersAction,
} from "@/server/domain/finance/actions";
import { todaySaoPaulo } from "@/server/domain/finance/schemas";

export const metadata: Metadata = { title: "Financeiro" };

type Params = Record<string, string | string[] | undefined>;

/** Lê NO SERVIDOR só os dados da aba aberta (com os filtros da URL). */
async function InternalTab({ tab, searchParams }: { tab: FinanceTab; searchParams: Params }) {
  switch (tab) {
    case "processos": {
      const query = processFinanceQueryFromSearchParams(searchParams);
      return <ProcessFinanceTable initialQuery={query} initialResult={await listProcessFinanceAction(processFinanceQueryToInput(query))} />;
    }
    case "contratos": {
      const query = agreementQueryFromSearchParams(searchParams);
      return (
        <AgreementsPanel
          initialQuery={query}
          initialResult={await listAgreementRowsAction(agreementQueryToInput(query))}
          syncUrl
          urlTab="contratos"
          description="Contratos de honorários de cada processo. Abra um contrato para ver as parcelas e registrar recebimentos."
        />
      );
    }
    case "a-receber": {
      const query = receivableQueryFromSearchParams(searchParams);
      return <ReceivablesPanel initialQuery={query} initialResult={await listReceivablesAction(receivableQueryToInput(query))} />;
    }
    case "recebimentos": {
      // Sem período na URL, o extrato abre no mês corrente (dia de São Paulo, o mesmo no servidor e na tela).
      const today = todaySaoPaulo();
      const query = receiptStatementQueryFromSearchParams(searchParams, today);
      return <ReceiptStatementPanel today={today} initialQuery={query} initialResult={await listReceiptStatementAction(receiptStatementQueryToInput(query))} />;
    }
    case "despesas": {
      const query = expenseQueryFromSearchParams(searchParams);
      return <ExpensesPanel initialQuery={query} initialResult={await listExpensesAction(expenseQueryToInput(query))} syncUrl urlTab="despesas" title="Despesas dos processos" />;
    }
    case "modelos": {
      const [models, catalog] = await Promise.all([loadAllPages((page, pageSize) => listFeeModelsAction({ page, pageSize })), getCaseCatalogAction()]);
      const areas = catalog.ok ? catalog.data.areas.map((a) => ({ value: a.id, label: a.name })) : [];
      return <FeeModelsPanel models={models} areas={areas} />;
    }
    default: {
      const [summary, totals, expenses, aging] = await Promise.all([getFinanceSummaryAction(), getProcessFinanceTotalsAction(), getExpenseSummaryAction(), getReceivableAgingAction()]);
      return <FinanceOverviewTab summary={summary} totals={totals} expenses={expenses} aging={aging} />;
    }
  }
}

/** Interno (ADMIN): Financeiro em abas (`?aba=`), tudo ligado ao processo. */
async function Internal({ searchParams }: { searchParams: Params }) {
  const tab = financeTabFromSearchParams(searchParams);
  return (
    <FinanceWorkspace tab={tab}>
      <InternalTab tab={tab} searchParams={searchParams} />
    </FinanceWorkspace>
  );
}

/** Portal (só PARTNER_ADMIN): SÓ a participação do próprio escritório — o escritório vem da sessão. */
async function Partner() {
  const [summary, shares, transfers, metrics] = await Promise.all([
    getMyPartnerFinanceAction(),
    listPartnerAgreementSharesAction({ pageSize: 50 }),
    listTransfersAction({ pageSize: 50 }),
    getDashboardMetricsAction({ period: "365" }),
  ]);
  return <PortalFinance summary={summary} shares={shares} transfers={transfers} metrics={metrics} />;
}

export default async function FinancePage({ searchParams }: PageProps<"/financeiro">) {
  const params = await searchParams;
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="finance.view">
          <Internal searchParams={params} />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.finance.view">
          <Partner />
        </RequirePermission>
      }
    />
  );
}
