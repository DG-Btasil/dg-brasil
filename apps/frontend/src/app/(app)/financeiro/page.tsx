import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { FinanceOverview } from "@/features/finance/components/finance-overview";
import { PortalFinance } from "@/features/partner-portal/components/portal-finance";

/** Interno: Financeiro global. Parceiro: somente Partner Admin (Partner User é bloqueado). */
export default function FinancePage() {
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="finance.view">
          <FinanceOverview />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.finance.view">
          <PortalFinance />
        </RequirePermission>
      }
    />
  );
}
