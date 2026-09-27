"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { AGENT_AUTONOMY_DESCRIPTION, AGENT_AUTONOMY_LABEL } from "@/lib/constants/status";
import { formatCompact, formatNumber, formatUsd } from "@/lib/formatting";
import type { Agent, AgentTask } from "@/types";
import { useAiUsage } from "../../hooks";

export function AgentOverviewTab({ agent, tasks }: { agent: Agent; tasks: AgentTask[] }) {
  const usage = useAiUsage();
  const agentUsage = usage.byAgent.find((u) => u.agentId === agent.id);
  const counts = useMemo(
    () => ({
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "COMPLETED").length,
      waiting: tasks.filter((t) => t.status === "WAITING_REVIEW").length,
      issues: tasks.filter((t) => t.status === "BLOCKED" || t.status === "FAILED").length,
    }),
    [tasks],
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-5">
      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Sobre o agente" />
          <PanelBody className="space-y-4">
            <div>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Função</h3>
              <p className="mt-0.5 text-[13px] text-foreground">{agent.role}</p>
            </div>
            <div>
              <h3 className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Descrição</h3>
              <p className="mt-0.5 text-[13px] leading-relaxed text-foreground">{agent.description}</p>
            </div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Permissões declaradas" description="O que o agente pode fazer, em linguagem de negócio." />
          <PanelBody>
            {agent.permissions.length === 0 ? (
              <p className="text-[13px] text-muted">Nenhuma permissão declarada.</p>
            ) : (
              <ul className="space-y-2">
                {agent.permissions.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[13px] text-foreground">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Nível de autonomia" />
          <PanelBody>
            <p className="text-[13.5px] font-semibold text-navy">{AGENT_AUTONOMY_LABEL[agent.autonomy]}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{AGENT_AUTONOMY_DESCRIPTION[agent.autonomy]}</p>
          </PanelBody>
        </Panel>
      </div>
      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Atividade recente" description="Tarefas registradas para este agente." />
          <PanelBody>
            <MetricGrid
              items={[
                { label: "Tarefas", value: formatNumber(counts.total) },
                { label: "Concluídas", value: formatNumber(counts.completed) },
                { label: "Aguardando revisão", value: formatNumber(counts.waiting) },
                { label: "Bloqueadas ou com falha", value: formatNumber(counts.issues) },
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Consumo do mês" description={`Referência: ${usage.month}`} />
          <PanelBody>
            {agentUsage ? (
              <MetricGrid
                items={[
                  { label: "Tokens de entrada", value: formatCompact(agentUsage.inputTokens) },
                  { label: "Tokens de saída", value: formatCompact(agentUsage.outputTokens) },
                  { label: "Custo estimado", value: formatUsd(agentUsage.costUsd) },
                ]}
              />
            ) : (
              <p className="text-[13px] text-muted">Sem consumo registrado neste mês.</p>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function MetricGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[11.5px] text-muted">{i.label}</dt>
          <dd className="mt-0.5 text-[18px] font-semibold tabular text-navy">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
