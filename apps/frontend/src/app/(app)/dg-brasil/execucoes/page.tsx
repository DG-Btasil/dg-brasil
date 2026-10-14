import { PageContainer } from "@/components/layout/guards";
import { AgentRunsPanel } from "@/features/agent-runs/components/agent-runs-panel";
import { agentRunQueryFromSearchParams, agentRunQueryToInput } from "@/features/agent-runs/list-query";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { listAgentRunsAction } from "@/server/domain/agents/actions";

/** Execuções de agente (área DG Brasil, ADMIN): primeira página do servidor, situação na URL. */
export default async function DgRunsPage({ searchParams }: PageProps<"/dg-brasil/execucoes">) {
  const query = agentRunQueryFromSearchParams(await searchParams);
  const result = await listAgentRunsAction(agentRunQueryToInput(query));
  return (
    <PageContainer>
      <DgHeader active="execucoes" />
      <AgentRunsPanel initialQuery={query} initialResult={result} syncUrl />
    </PageContainer>
  );
}
