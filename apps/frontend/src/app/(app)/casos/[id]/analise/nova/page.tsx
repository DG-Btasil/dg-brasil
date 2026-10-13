import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { CaseNotFound } from "@/features/cases/components/case-not-found";
import { AnalysisWizard } from "@/features/analyses/components/wizard/analysis-wizard";
import { IN_FLIGHT_STATUSES } from "@/features/analyses/fields";
import { getAnalysisSetupAction, listAnalysesAction } from "@/server/domain/analyses/actions";
import { getCaseAction } from "@/server/domain/cases/actions";

/** Caso, modelos ativos da área (com checklist do caso) e análises existentes — tudo do servidor. */
async function Wizard({ id }: { id: string }) {
  const found = await getCaseAction({ id });
  if (!found.ok) {
    if (found.error.code === "NOT_FOUND" || found.error.code === "VALIDATION") return <CaseNotFound />;
    return <ActionErrorState error={found} title="Não foi possível abrir o caso." />;
  }
  if (found.data.surface !== "INTERNAL") return <CaseNotFound />;
  const [setup, analyses] = await Promise.all([getAnalysisSetupAction({ legalCaseId: id }), listAnalysesAction({ legalCaseId: id, pageSize: 50 })]);
  if (!setup.ok) return <ActionErrorState error={setup} title="Não foi possível abrir a análise." />;
  const items = analyses.ok ? analyses.data.items : [];
  const c = found.data.legalCase;
  return (
    <AnalysisWizard
      legalCase={{ id: c.id, title: c.title, clientName: c.clientName }}
      templates={setup.data.templates}
      inFlightId={items.find((a) => IN_FLIGHT_STATUSES.includes(a.dbStatus))?.id}
      pendingId={items.find((a) => a.dbStatus === "PENDING" || a.dbStatus === "WAITING_DOCUMENTS")?.id}
    />
  );
}

export default async function NewCaseAnalysisPage({ params }: PageProps<"/casos/[id]/analise/nova">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="cases.view">
        <RequirePermission permission="analyses.start">
          <Wizard id={id} />
        </RequirePermission>
      </RequirePermission>
    </PageContainer>
  );
}
