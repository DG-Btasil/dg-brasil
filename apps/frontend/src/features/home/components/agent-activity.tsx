"use client";

import { Activity } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { AGENT_TASK_STATUS_LABEL, AGENT_TASK_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useAgentActivity } from "../feed-hooks";

/** Atividade recente dos agentes. Montar somente com "dgbrasil.activity.view". */
export function AgentActivity() {
  const rows = useAgentActivity();
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Atividade do DG Brasil"
        description="O que os agentes fizeram recentemente"
        actions={
          <ButtonLink href="/dg-brasil" variant="secondary" size="sm">
            Abrir DG Brasil
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <EmptyState compact icon={Activity} title="Nenhuma atividade registrada" description="As execuções dos agentes aparecerão aqui, com status e horário." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ task, sentence }) => (
            <li key={task.id} className="flex items-start gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-foreground">{sentence}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{task.title}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={task.status} labels={AGENT_TASK_STATUS_LABEL} tones={AGENT_TASK_STATUS_TONE} />
                <span className="text-[11.5px] tabular text-subtle">{formatEventTime(task.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
