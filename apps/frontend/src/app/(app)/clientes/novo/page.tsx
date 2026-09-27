import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { ClientCreate } from "@/features/clients/components/form/client-create";

export default function NewClientPage() {
  return (
    <PageContainer>
      <RequirePermission permission="clients.edit">
        <ClientCreate />
      </RequirePermission>
    </PageContainer>
  );
}
