import { RequirePermission } from "@/components/layout/guards";
import { FinanceOverview } from "@/features/finance/components/finance-overview";

export default function FinancePage() {
  return (
    <RequirePermission permission="finance.view">
      <FinanceOverview />
    </RequirePermission>
  );
}
