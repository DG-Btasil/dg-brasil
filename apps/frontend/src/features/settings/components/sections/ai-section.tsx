"use client";

import { useMemo } from "react";
import { AiPlatformCard } from "@/features/integrations/components/ai/ai-platform-card";
import { DailyUsageChart, RunsByAgentChart, UsageByModelTable } from "@/features/integrations/components/ai/ai-usage-charts";
import { useAgentNameMap, useAIUsage, useIntegrations } from "@/features/integrations/hooks";
import { SectionHeader } from "../section-header";

export function AiSection() {
  const usage = useAIUsage();
  const integrations = useIntegrations();
  const agentNames = useAgentNameMap();

  const byAgent = useMemo(
    () => usage.byAgent.map((a) => ({ name: agentNames.get(a.agentId) ?? "Agente removido", runs: a.runs })).sort((a, b) => b.runs - a.runs),
    [usage.byAgent, agentNames],
  );
  const integration = integrations.find((i) => i.kind === "AI_PROVIDER");

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Configuração Claude"
        description="Status da conexão, uso, execuções e limites dos agentes no mês. Dados sincronizados pelo backend."
      />
      <AiPlatformCard usage={usage} integration={integration} topAgent={byAgent[0]} />
      <DailyUsageChart daily={usage.daily} />
      <div className="grid grid-cols-2 gap-5">
        <RunsByAgentChart data={byAgent} />
        <UsageByModelTable byModel={usage.byModel} />
      </div>
    </div>
  );
}
