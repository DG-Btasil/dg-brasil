import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ClientList } from "@/features/clients/components/list/client-list";
import { PortalClientList } from "@/features/partner-portal/components/portal-clients";

export default function ClientsPage() {
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="clients.view">
            <ClientList />
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalClientList />
        </RequirePermission>
      }
    />
  );
}
