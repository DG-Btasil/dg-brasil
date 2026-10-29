"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus, Users } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime, pluralize } from "@/lib/formatting";
import type { AgentListItemDTO, DgCatalogDTO } from "@/server/domain/dg/dto";
import { dgRoutes, formatVersion } from "../../utils";
import { AgentFormDrawer } from "./agent-form-drawer";

export function AgentList({ agents, catalog }: { agents: AgentListItemDTO[]; catalog: DgCatalogDTO }) {
  const [creating, setCreating] = useState(false);
  const createButton = (
    <Can permission="dgbrasil.manage">
      <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
        Criar agente
      </Button>
    </Can>
  );
  const drawer = creating && <AgentFormDrawer open onOpenChange={setCreating} catalog={catalog} />;

  if (agents.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={Users}
          title="Nenhum agente configurado."
          description="Crie um agente com as instruções que você já usa no Claude Code (dá para importar o arquivo .md)."
          action={createButton}
        />
        {drawer}
      </Panel>
    );
  }

  return (
    <section aria-labelledby="dg-agents-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 id="dg-agents-title" className="text-[15px] font-semibold text-foreground">
            Equipe digital
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Cada agente executa dentro do DG Brasil e propõe; toda entrega passa por Revisões.</p>
        </div>
        {createButton}
      </div>
      <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        {agents.map((agent) => (
          <li key={agent.id}>
            <AgentCard agent={agent} />
          </li>
        ))}
      </ul>
      {drawer}
    </section>
  );
}

function AgentCard({ agent }: { agent: AgentListItemDTO }) {
  return (
    <Link
      href={dgRoutes.agent(agent.id)}
      className="group flex h-full flex-col rounded-lg border border-line bg-surface px-5 py-4 shadow-hairline transition-colors hover:border-navy-600/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground group-hover:text-navy">{agent.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{agent.description || agent.purpose || "Sem descrição."}</p>
        </div>
        <StatusBadge status={agent.status} labels={AGENT_STATUS_LABEL} tones={AGENT_STATUS_TONE} />
      </div>
      <p className="mt-3 text-[12px] text-muted">
        <span className="text-subtle">No Claude Code: </span>
        {agent.localAgent ? <code className="font-mono text-foreground">{agent.localAgent}</code> : <span className="text-warning">não definido</span>}
      </p>
      <dl className="mt-3 grid grid-cols-4 gap-3 border-t border-line pt-3 text-[12px]">
        <Metric label="Teses" value={pluralize(agent.thesisCount, "Tese", "Teses")} />
        <Metric label="Última execução" value={agent.lastRunAt ? formatEventTime(agent.lastRunAt) : "Sem execuções"} />
        <Metric label="Execuções (7 dias)" value={String(agent.runsLast7Days)} />
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
