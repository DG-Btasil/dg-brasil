import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { AGENT_AUTONOMY_LABEL, AGENT_STATUS_LABEL, AGENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime, pluralize } from "@/lib/formatting";
import type { Agent } from "@/types";
import { dgRoutes, formatVersion } from "../../utils";

export function AgentCard({ agent, recentTasks }: { agent: Agent; recentTasks: number }) {
  return (
    <Link
      href={dgRoutes.agent(agent.id)}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface px-5 py-4 shadow-hairline transition-colors hover:border-navy-600/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground group-hover:text-navy">{agent.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{agent.role}</p>
        </div>
        <StatusBadge status={agent.status} labels={AGENT_STATUS_LABEL} tones={AGENT_STATUS_TONE} />
      </div>
      <p className="mt-3 text-[12px] text-muted">
        <span className="text-subtle">Autonomia: </span>
        <span className="text-foreground">{AGENT_AUTONOMY_LABEL[agent.autonomy]}</span>
      </p>
      <dl className="mt-3 grid grid-cols-4 gap-3 border-t border-line pt-3 text-[12px]">
        <Metric label="Skills" value={pluralize(agent.skillIds.length, "Skill", "Skills")} />
        <Metric label="Última execução" value={agent.lastRunAt ? formatEventTime(agent.lastRunAt) : "Sem execuções"} />
        <Metric label="Tarefas (7 dias)" value={pluralize(recentTasks, "tarefa", "tarefas")} />
        <Metric label="Versão" value={formatVersion(agent.version)} />
      </dl>
      <span className="mt-3 inline-flex items-center gap-1 self-end text-[12px] font-medium text-navy-700">
        Ver agente <ChevronRight aria-hidden className="size-3.5" />
      </span>
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.05em] text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate tabular text-foreground">{value}</dd>
    </div>
  );
}
