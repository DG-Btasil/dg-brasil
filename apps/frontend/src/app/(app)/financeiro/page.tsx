import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { FinanceOverview } from "@/features/finance/components/finance-overview";
import { agreementQueryFromSearchParams, agreementQueryToInput } from "@/features/finance/list-query";
import { PortalFinance } from "@/features/partner-portal/components/portal-finance";
import { getFinanceSummaryAction, getMyPartnerFinanceAction, listAgreementRowsAction, listPartnerAgreementSharesAction, listTransfersAction } from "@/server/domain/finance/actions";

/** Interno (ADMIN): totais agregados no servidor + primeira página dos contratos, com a situação da URL. */
async function Internal({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = agreementQueryFromSearchParams(searchParams);
  const [summary, list] = await Promise.all([getFinanceSummaryAction(), listAgreementRowsAction(agreementQueryToInput(query))]);
  return <FinanceOverview summary={summary} initialQuery={query} initialResult={list} />;
}

/** Portal (só PARTNER_ADMIN): SÓ a participação do próprio escritório — o escritório vem da sessão. */
async function Partner() {
  const [summary, shares, transfers] = await Promise.all([
    getMyPartnerFinanceAction(),
    listPartnerAgreementSharesAction({ pageSize: 50 }),
    listTransfersAction({ pageSize: 50 }),
  ]);
  return <PortalFinance summary={summary} shares={shares} transfers={transfers} />;
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
