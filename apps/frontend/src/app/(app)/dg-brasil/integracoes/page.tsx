import { PageContainer } from "@/components/layout/guards";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { IntegrationsSection } from "@/features/settings/components/sections/integrations-section";
import { getDgOverviewAction } from "@/server/domain/dg/actions";

/** Central DG Brasil → Integrações: DJEN/DataJud, Google Drive e importações (vieram de Configurações no Roadmap 2.0). */
export default async function DgIntegrationsPage() {
  const overview = await getDgOverviewAction();
  return (
    <PageContainer>
      <DgHeader active="integracoes" overview={overview.ok ? overview.data : undefined} />
      <IntegrationsSection />
    </PageContainer>
  );
}
