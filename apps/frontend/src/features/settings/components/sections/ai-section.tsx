"use client";

import { useMemo } from "react";
import { AiPlatformCard } from "@/features/integrations/components/ai/ai-platform-card";
import { CostByAgentChart, DailyUsageChart, TokensByAgentChart, UsageByModelTable } from "@/features/integrations/components/ai/ai-usage-charts";
import { useAgentNameMap, useAIUsage, useIntegrations } from "@/features/integrations/hooks";
import { SectionHeader } from "../section-header";

export function AiSection() {
  const usage = useAIUsage();
  const integrations = useIntegrations();
  const agentNames = useAgentNameMap();

  const byAgent = useMemo(
    () =>
      usage.byAgent
        .map((a) => ({ name: agentNames.get(a.agentId) ?? "Agente removido", tokens: a.inputTokens + a.outputTokens, costUsd: a.costUsd }))
        .sort((a, b) => b.tokens - a.tokens),
    [usage.byAgent, agentNames],
  );
  const integration = integrations.find((i) => i.kind === "AI_PROVIDER");

  return (
    <div className="space-y-5">
      <SectionHeader
        title="IA e consumo"
        description="Conexão do escritório com a Claude Platform e consumo dos agentes no mês. Valores estimados, sincronizados pelo backend."
      />
      <AiPlatformCard usage={usage} integration={integration} topAgent={byAgent[0]} />
      <DailyUsageChart daily={usage.daily} />
      <div className="grid grid-cols-2 gap-5">
        <TokensByAgentChart data={byAgent} />
        <CostByAgentChart data={byAgent} />
      </div>
      <UsageByModelTable byModel={usage.byModel} />
    </div>
  );
}
