import { AudienceSwitch, PageContainer, RequirePermission } from "@/components/layout/guards";
import { ClientCreate } from "@/features/clients/components/form/client-create";
import { NewCaseWizard } from "@/features/partner-portal/components/new-case-wizard";

export default function NewClientPage() {
  return (
    <PageContainer>
      <AudienceSwitch
        owner={
          <RequirePermission permission="clients.edit">
            <ClientCreate />
          </RequirePermission>
        }
        partner={
          <RequirePermission permission="partnerPortal.clients.create">
            <NewCaseWizard />
          </RequirePermission>
        }
      />
    </PageContainer>
  );
}
