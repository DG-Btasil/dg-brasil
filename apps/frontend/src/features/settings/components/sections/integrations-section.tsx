import { IntegrationsList } from "@/features/integrations/components/integrations-list";
import { SectionHeader } from "../section-header";

export function IntegrationsSection() {
  return (
    <div>
      <SectionHeader
        title="Integrações"
        description="Serviços conectados ao escritório. Status, última sincronização e ações disponíveis para o seu perfil."
      />
      <IntegrationsList />
    </div>
  );
}
