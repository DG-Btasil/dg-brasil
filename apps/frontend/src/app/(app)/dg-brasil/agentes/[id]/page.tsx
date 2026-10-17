import { PageContainer } from "@/components/layout/guards";
import { DEFAULT_AGENT_RUN_QUERY, agentRunQueryToInput } from "@/features/agent-runs/list-query";
import { AgentDetail } from "@/features/dg-brasil/components/agents/agent-detail";
import { DgNotFound } from "@/features/dg-brasil/components/shared/not-found";
import { dgRoutes } from "@/features/dg-brasil/utils";
import { listAgentRunsAction } from "@/server/domain/agents/actions";
import { getDgAgentAction, getDgCatalogAction } from "@/server/domain/dg/actions";

export default async function AgentPage({ params }: PageProps<"/dg-brasil/agentes/[id]">) {
  const { id } = await params;
  const [agent, catalog, runs] = await Promise.all([
    getDgAgentAction({ id }),
    getDgCatalogAction(),
    listAgentRunsAction(agentRunQueryToInput(DEFAULT_AGENT_RUN_QUERY, { agentId: id })),
  ]);
  if (!agent.ok || !catalog.ok) return <DgNotFound title="Agente não encontrado" backHref={dgRoutes.home} backLabel="Voltar para os agentes" />;
  return (
    <PageContainer>
      <AgentDetail agent={agent.data} catalog={catalog.data} runs={runs} />
    </PageContainer>
  );
}
