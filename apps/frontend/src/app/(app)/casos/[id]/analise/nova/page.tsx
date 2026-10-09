import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { AnalysisWizard } from "@/features/analyses/components/wizard/analysis-wizard";

export default async function NewCaseAnalysisPage({ params }: PageProps<"/casos/[id]/analise/nova">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="cases.view">
        <RequirePermission permission="analyses.start">
          <AnalysisWizard legalCaseId={id} />
        </RequirePermission>
      </RequirePermission>
    </PageContainer>
  );
}
