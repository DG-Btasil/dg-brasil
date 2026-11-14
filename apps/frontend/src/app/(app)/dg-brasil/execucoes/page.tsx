import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/guards";
import { AgentRunsPanel } from "@/features/agent-runs/components/agent-runs-panel";
import { agentRunQueryFromSearchParams, agentRunQueryToInput } from "@/features/agent-runs/list-query";
import { DgHeader } from "@/features/dg-brasil/components/shared/dg-header";
import { listAgentRunsAction } from "@/server/domain/agents/actions";
import { getDgOverviewAction, getOfficeStatusAction } from "@/server/domain/dg/actions";

export const metadata: Metadata = { title: "Execuções" };

/** Execuções de agente (área DG Brasil, ADMIN): primeira página do servidor, situação na URL. */
export default async function DgRunsPage({ searchParams }: PageProps<"/dg-brasil/execucoes">) {
  const query = agentRunQueryFromSearchParams(await searchParams);
  const [result, overview, office] = await Promise.all([listAgentRunsAction(agentRunQueryToInput(query)), getDgOverviewAction(), getOfficeStatusAction()]);
  return (
    <PageContainer>
      <DgHeader active="execucoes" overview={overview.ok ? overview.data : undefined} />
      <AgentRunsPanel
        initialQuery={query}
        initialResult={result}
        syncUrl
        office={office.ok ? { executionEnabled: office.data.executionEnabled, online: office.data.online } : undefined}
      />
    </PageContainer>
  );
}
