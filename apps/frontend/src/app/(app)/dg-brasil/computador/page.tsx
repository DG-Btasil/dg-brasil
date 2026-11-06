import { PageContainer } from "@/components/layout/guards";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { AiSection } from "@/features/settings/components/sections/ai-section";
import { getDgOverviewAction } from "@/server/domain/dg/actions";

/** Central DG Brasil → Computador do escritório (veio de Configurações no Roadmap 2.0). */
export default async function DgComputerPage() {
  const overview = await getDgOverviewAction();
  return (
    <PageContainer>
      <DgHeader active="computador" overview={overview.ok ? overview.data : undefined} />
      <AiSection />
    </PageContainer>
  );
}
