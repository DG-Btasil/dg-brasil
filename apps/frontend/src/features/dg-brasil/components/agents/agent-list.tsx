"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Panel } from "@/components/ui/panel";
import { daysSince } from "@/lib/clock";
import { useAgents, useAgentTasks } from "../../hooks";
import { AgentCard } from "./agent-card";

export function AgentList() {
  const agents = useAgents();
  const tasks = useAgentTasks();
  const recentByAgent = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) if (daysSince(t.at) <= 7) map.set(t.agentId, (map.get(t.agentId) ?? 0) + 1);
    return map;
  }, [tasks]);

  if (agents.length === 0) {
    return (
      <Panel>
        <EmptyState icon={Users} title="Nenhum agente configurado." description="Os agentes do escritório aparecerão aqui assim que forem configurados." />
      </Panel>
    );
  }

  return (
    <section aria-labelledby="dg-agents-title">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 id="dg-agents-title" className="text-[15px] font-semibold text-foreground">
            Equipe digital
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Cada agente é um integrante especializado. Toda ação externa passa por Revisões ou confirmação humana.
          </p>
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 2xl:grid-cols-3">
        {agents.map((agent) => (
          <li key={agent.id}>
            <AgentCard agent={agent} recentTasks={recentByAgent.get(agent.id) ?? 0} />
          </li>
        ))}
      </ul>
    </section>
  );
}
