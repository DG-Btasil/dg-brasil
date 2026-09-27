"use client";

import { useMemo, useState } from "react";
import { History, NotebookPen, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROCESS_EVENT_SOURCE_LABEL, PROCESS_EVENT_SOURCES, type ProcessEventSource, type Tone } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import { useProcessEvents } from "../../hooks";

const SOURCE_TONE: Record<ProcessEventSource, Tone> = {
  COURT: "navy",
  INTEGRATION: "info",
  AGENT: "gold",
  MANUAL: "neutral",
  SYSTEM: "neutral",
};

export function EventsTab({ processId, onAdd }: { processId: string; onAdd: () => void }) {
  const events = useProcessEvents(processId);
  const [source, setSource] = useState<ProcessEventSource | "ALL">("ALL");

  const available = useMemo(() => PROCESS_EVENT_SOURCES.filter((s) => events.some((e) => e.source === s)), [events]);
  const visible = useMemo(() => (source === "ALL" ? events : events.filter((e) => e.source === source)), [events, source]);

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
                  {e.title}
                  <Badge tone={SOURCE_TONE[e.source]}>{PROCESS_EVENT_SOURCE_LABEL[e.source]}</Badge>
                  {e.important && (
                    <Badge tone="gold" icon={<Star className="size-3" aria-hidden />}>
                      Relevante
                    </Badge>
                  )}
                </span>
              ),
              description: e.description ? <span className="whitespace-pre-line">{e.description}</span> : undefined,
              meta: formatDateTime(e.at),
            }))}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
