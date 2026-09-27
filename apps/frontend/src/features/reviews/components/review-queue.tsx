"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/feedback/states";
import { useResponsibleOptions } from "@/features/offices/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { useAgentMap, useClientList, useProcessMap, useReviews } from "../hooks";
import {
  compareReviewQueue,
  countReviewFilters,
  EMPTY_REVIEW_FILTERS,
  filterReviews,
  matchesView,
  QUEUE_VIEW_LABEL,
  QUEUE_VIEWS,
  type QueueView,
  type ReviewFilters as Filters,
} from "../utils";
import { ReviewFilters } from "./review-filters";
import { ReviewTable } from "./review-table";

export function ReviewQueue() {
  const reviews = useReviews();
  const agents = useAgentMap();
  const processes = useProcessMap();
  const clientList = useClientList();
  const userOptions = useResponsibleOptions();
  const [view, setView] = useState<QueueView>("pendentes");
  const [filters, setFilters] = useState<Filters>(EMPTY_REVIEW_FILTERS);

  const clients = useMemo(() => new Map(clientList.map((c) => [c.id, c])), [clientList]);

  const visible = useMemo(() => {
    const list = filterReviews(reviews, view, filters);
    return view === "decididas"
      ? list.sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
      : list.sort(compareReviewQueue);
  }, [reviews, view, filters]);

  const tabItems = QUEUE_VIEWS.map((key) => ({
    key,
    label: QUEUE_VIEW_LABEL[key],
    count: reviews.filter((r) => matchesView(r, key)).length,
    attention: key === "pendentes" && reviews.some((r) => r.status === "URGENT"),
  }));

  const options = useMemo(() => {
    const uniq = (ids: (string | undefined)[]) => [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, "pt-BR");
    return {
      agents: uniq(reviews.map((r) => r.agentId)).map((id) => ({ value: id, label: agents.get(id)?.name ?? id })).sort(byLabel),
      clients: uniq(reviews.map((r) => r.clientId)).map((id) => ({ value: id, label: clientDisplayName(clients.get(id)) })).sort(byLabel),
      processes: uniq(reviews.map((r) => r.processId)).map((id) => ({ value: id, label: processes.get(id)?.title ?? id })).sort(byLabel),
    };
  }, [reviews, agents, clients, processes]);

  const hasFilters = countReviewFilters(filters) > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Revisões"
        description="Tudo o que os agentes produzem passa por aqui antes de seguir. Nada vira ação externa sem a sua decisão."
      />
      <Tabs items={tabItems} value={view} onChange={setView} label="Visões da fila de revisões" className="mb-4" />
      <Panel>
        <ReviewFilters
          filters={filters}
          onChange={setFilters}
          agentOptions={options.agents}
          clientOptions={options.clients}
          processOptions={options.processes}
          userOptions={userOptions}
          showStatus={view !== "pendentes"}
        />
        {visible.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={SearchX}
              title="Nenhuma revisão corresponde aos filtros."
              action={
                <Button variant="secondary" onClick={() => setFilters(EMPTY_REVIEW_FILTERS)}>
                  Limpar filtros
                </Button>
              }
            />
          ) : view === "pendentes" ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nenhuma revisão aguardando decisão."
              description="Quando um agente concluir uma tarefa que exige confirmação, o material aparecerá aqui para você aprovar, pedir ajustes ou rejeitar."
            />
          ) : (
            <EmptyState title="Nenhuma revisão nesta visão." />
          )
        ) : (
          <>
            <p className="border-b border-line px-5 py-2 text-[12px] text-muted" aria-live="polite">
              {visible.length === 1 ? "1 revisão" : `${visible.length} revisões`}
              {view === "pendentes" && " · urgentes e de maior prioridade primeiro, depois as mais antigas"}
            </p>
            <ReviewTable reviews={visible} agents={agents} clients={clients} processes={processes} />
          </>
        )}
      </Panel>
    </PageContainer>
  );
}
