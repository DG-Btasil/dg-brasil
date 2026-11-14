import type { Metadata } from "next";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { RunDetail } from "@/features/agent-runs/components/run-detail";
import { getAgentRunDetailAction } from "@/server/domain/agents/actions";
import { getOfficeStatusAction } from "@/server/domain/dg/actions";

export const metadata: Metadata = { title: "Execução" };

/**
 * Uma execução de agente (ADMIN e LAWYER; o banco decide o acesso por caso).
 * A situação do computador do escritório vem junto: na fila, a tela diz se a
 * execução está desligada ou se não há computador conectado.
 */
export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, office] = await Promise.all([getAgentRunDetailAction({ id }), getOfficeStatusAction()]);
  return (
    <RequirePermission permission="analyses.start">
      <PageContainer>
        <RunDetail result={result} office={office.ok ? { executionEnabled: office.data.executionEnabled, online: office.data.online } : undefined} />
      </PageContainer>
    </RequirePermission>
  );
}
