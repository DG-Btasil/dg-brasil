"use client";

import { useMemo, useState } from "react";
import { History, NotebookPen, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROCESS_EVENT_SOURCE_LABEL, PROCESS_EVENT_SOURCES, type ProcessEventSource, type Tone } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import type { Page } from "@/server/core/pagination";
import { listProcessEventsAction } from "@/server/domain/processes/actions";
import type { ProcessEventDTO } from "@/server/domain/processes/dto";

const SOURCE_TONE: Record<ProcessEventSource, Tone> = {
  JUDICIAL_INTEGRATION: "navy",
  IMPORT: "info",
  AGENT: "gold",
  MANUAL: "neutral",
  SYSTEM: "neutral",
};

/**
 * Movimentações do processo, mais recentes primeiro (página do servidor +
 * "carregar mais"). A origem de cada uma vem do banco: nota da equipe,
 * sistema ou integração — a equipe nunca lança movimentação "oficial".
 */
export function EventsTab({ processId, initial, onAdd }: { processId: string; initial: ActionResult<Page<ProcessEventDTO>>; onAdd: () => void }) {
  const failed = useActionFeedback();
  const [pages, setPages] = useState<{ items: ProcessEventDTO[]; page: number; total: number } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [source, setSource] = useState<ProcessEventSource | "ALL">("ALL");
  // Novos dados do servidor (após registrar andamento) substituem o acumulado.
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setPages(null);
  }
  const current = useMemo(() => pages ?? (initial.ok ? { items: initial.data.items, page: initial.data.page, total: initial.data.total } : null), [pages, initial]);
  const events = useMemo(() => current?.items ?? [], [current]);
  const available = useMemo(() => PROCESS_EVENT_SOURCES.filter((s) => events.some((e) => e.source === s)), [events]);
  const visible = useMemo(() => (source === "ALL" ? events : events.filter((e) => e.source === source)), [events, source]);

  if (!initial.ok) return <ActionErrorState error={initial} title="Não foi possível carregar as movimentações." />;

  async function loadMore() {
    if (!current) return;
    setLoadingMore(true);
    const next = await callAction(() => listProcessEventsAction({ processId, page: current.page + 1, pageSize: initial.ok ? initial.data.pageSize : 50 }));
    setLoadingMore(false);
    if (!next.ok) {
      failed(next, "Não foi possível carregar mais movimentações.");
      return;
    }
    const seen = new Set(current.items.map((e) => e.id));
    setPages({ items: [...current.items, ...next.data.items.filter((e) => !seen.has(e.id))], page: next.data.page, total: next.data.total });
  }

  const chips: { key: ProcessEventSource | "ALL"; label: string; count: number }[] = [
    { key: "ALL", label: "Todas", count: events.length },
    ...available.map((s) => ({ key: s, label: PROCESS_EVENT_SOURCE_LABEL[s], count: events.filter((e) => e.source === s).length })),
  ];

  return (
    <Panel>
      <PanelHeader
        title="Movimentações"
        as="h3"
        description="Mais recentes primeiro. Andamentos relevantes aparecem destacados."
        actions={
          <Can permission="processes.edit">
            <Button size="sm" variant="secondary" icon={<NotebookPen className="size-3.5" aria-hidden />} onClick={onAdd}>
              Registrar andamento
            </Button>
          </Can>
        }
      />
      {events.length === 0 ? (
        <EmptyState compact icon={History} title="Nenhuma movimentação registrada." description="Andamentos do tribunal, da integração e da equipe aparecerão aqui." />
      ) : (
        <PanelBody>
          <div role="group" aria-label="Filtrar por origem" className="mb-5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-pressed={source === c.key}
                onClick={() => setSource(c.key)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
                  source === c.key ? "border-navy bg-navy text-white" : "border-line-strong bg-surface text-muted hover:text-foreground",
                )}
              >
                {c.label}
                <span className="tabular opacity-70">{c.count}</span>
              </button>
            ))}
          </div>
          <Timeline
            className="max-w-[860px]"
            items={visible.map((e) => ({
              id: e.id,
              highlight: e.important,
              tone: e.important ? "gold" : SOURCE_TONE[e.source],
              title: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {e.title ?? e.description.slice(0, 120)}
                  <Badge tone={SOURCE_TONE[e.source]}>{PROCESS_EVENT_SOURCE_LABEL[e.source]}</Badge>
                  {e.important && (
                    <Badge tone="gold" icon={<Star className="size-3" aria-hidden />}>
                      Relevante
                    </Badge>
                  )}
                </span>
              ),
              description: e.title && e.description && e.description !== e.title ? <span className="whitespace-pre-line">{e.description}</span> : undefined,
              meta: formatDateTime(e.occurredAt),
            }))}
          />
          {current && current.total > events.length && (
            <div className="mt-4">
              <Button variant="secondary" size="sm" loading={loadingMore} onClick={loadMore}>
                Carregar mais ({current.total - events.length} restantes)
              </Button>
            </div>
          )}
        </PanelBody>
      )}
    </Panel>
  );
}
