import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { CaseList } from "@/features/cases/components/case-list";
import { PortalCaseList } from "@/features/partner-portal/components/portal-cases";

export default function CasesPage() {
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="cases.view">
          <CaseList />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalCaseList />
        </RequirePermission>
      }
    />
  );
}
