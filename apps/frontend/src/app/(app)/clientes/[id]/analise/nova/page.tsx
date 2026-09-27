import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { AnalysisWizard } from "@/features/analyses/components/wizard/analysis-wizard";

export default async function NewAnalysisPage({ params }: PageProps<"/clientes/[id]/analise/nova">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="clients.view">
        <RequirePermission permission="analyses.start">
          <AnalysisWizard clientId={id} />
        </RequirePermission>
      </RequirePermission>
    </PageContainer>
  );
}
