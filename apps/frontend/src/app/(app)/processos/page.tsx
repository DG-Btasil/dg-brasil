import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ProcessList } from "@/features/processes/components/process-list";
import { PortalProcessList } from "@/features/partner-portal/components/portal-processes";

export default function ProcessesPage() {
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.view">
          <ProcessList />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalProcessList />
        </RequirePermission>
      }
    />
  );
}
