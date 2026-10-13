import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { ClientCreate } from "@/features/clients/components/form/client-create";
import { NewCaseWizard } from "@/features/partner-portal/components/new-case-wizard";
import { getCaseCatalogAction } from "@/server/domain/cases/actions";

/** Portal: novo cliente = envio de cliente + primeiro caso (catálogo do servidor). */
async function PartnerWizard() {
  const catalog = await getCaseCatalogAction();
  if (!catalog.ok) return <ActionErrorState error={catalog} title="Não foi possível abrir o cadastro." />;
  return <NewCaseWizard catalog={catalog.data} />;
}

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
            <PartnerWizard />
          </RequirePermission>
        }
      />
    </PageContainer>
  );
}
