import type { Metadata } from "next";
import { connection } from "next/server";
import { PageContainer } from "@/components/layout/guards";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { IntegrationsSection } from "@/features/settings/components/sections/integrations-section";
import { getDgOverviewAction } from "@/server/domain/dg/actions";

export const metadata: Metadata = { title: "Integrações" };

/** Central DG Brasil → Integrações: DJEN/DataJud, Google Drive e importações (vieram de Configurações no Roadmap 2.0). */
export default async function DgIntegrationsPage() {
  // Página por usuário (lê a sessão): só é montada com a requisição, nunca no build.
  await connection();
  const overview = await getDgOverviewAction();
  return (
    <PageContainer>
      <DgHeader active="integracoes" overview={overview.ok ? overview.data : undefined} />
      <IntegrationsSection />
    </PageContainer>
  );
}
