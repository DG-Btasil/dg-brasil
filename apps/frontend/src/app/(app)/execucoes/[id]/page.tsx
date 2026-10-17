import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { RunDetail } from "@/features/agent-runs/components/run-detail";
import { getAgentRunDetailAction } from "@/server/domain/agents/actions";

/** Uma execução de agente (ADMIN e LAWYER; o banco decide o acesso por caso). */
export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="analyses.start">
      <PageContainer>
        <RunDetail result={await getAgentRunDetailAction({ id })} />
      </PageContainer>
    </RequirePermission>
  );
}
