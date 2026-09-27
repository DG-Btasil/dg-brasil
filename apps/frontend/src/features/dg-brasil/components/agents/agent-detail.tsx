"use client";

import { PageContainer } from "@/components/layout/guards";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import { useAgent, useAgentTasks } from "../../hooks";
import { dgRoutes } from "../../utils";
import { DgNotFound } from "../shared/not-found";
import { AgentActivityTab } from "./agent-activity-tab";
import { AgentAdvancedTab } from "./agent-advanced-tab";
import { AgentHeader } from "./agent-header";
import { AgentOverviewTab } from "./agent-overview-tab";
import { AgentRulesTab } from "./agent-rules-tab";
import { AgentSkillsTab, AgentThesesTab } from "./agent-links-tabs";

const TABS = ["visao-geral", "skills", "teses", "regras", "atividade", "configuracao-avancada"] as const;
type AgentTab = (typeof TABS)[number];

export function AgentDetail({ id }: { id: string }) {
  const agent = useAgent(id);
  const tasks = useAgentTasks(id);
  const [tab, setTab] = useUrlTab<AgentTab>(TABS, "visao-geral");

  if (!agent) return <DgNotFound title="Agente não encontrado" backHref={dgRoutes.home} backLabel="Voltar para os agentes" />;

  const items: TabItem<AgentTab>[] = [
    { key: "visao-geral", label: "Visão geral" },
    { key: "skills", label: "Skills", count: agent.skillIds.length },
    { key: "teses", label: "Teses", count: agent.thesisIds.length },
    { key: "regras", label: "Regras", count: agent.rules.length + 1 },
    { key: "atividade", label: "Atividade", count: tasks.length },
    { key: "configuracao-avancada", label: "Configuração avançada" },
  ];

  return (
    <PageContainer>
      <AgentHeader agent={agent} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do agente" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <AgentOverviewTab agent={agent} tasks={tasks} />}
        {tab === "skills" && <AgentSkillsTab agent={agent} />}
        {tab === "teses" && <AgentThesesTab agent={agent} />}
        {tab === "regras" && <AgentRulesTab agent={agent} />}
        {tab === "atividade" && <AgentActivityTab tasks={tasks} />}
        {tab === "configuracao-avancada" && <AgentAdvancedTab agent={agent} />}
      </TabPanel>
    </PageContainer>
  );
}
