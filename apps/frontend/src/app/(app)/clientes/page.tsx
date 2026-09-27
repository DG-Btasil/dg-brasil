import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { ClientList } from "@/features/clients/components/list/client-list";

export default function ClientsPage() {
  return (
    <PageContainer>
      <RequirePermission permission="clients.view">
        <ClientList />
      </RequirePermission>
    </PageContainer>
  );
}
