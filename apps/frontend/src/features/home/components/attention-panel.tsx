"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  PlugZap,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeadlineBadge } from "@/components/ui/display";
import { TONE_BORDER_LEFT, TONE_TEXT } from "@/components/ui/tone";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useAttentionItems, type AttentionItem, type AttentionKind, type AttentionLevel } from "../hooks";

const KIND_ICON: Record<AttentionKind, LucideIcon> = {
  DEADLINE: CalendarClock,
  ANALYSIS_BLOCKED: FileWarning,
  REVIEW_WAITING: ClipboardCheck,
  PROCESS_MOVEMENT: ScrollText,
  INTEGRATION_ERROR: PlugZap,
};

const LEVEL_TONE: Record<AttentionLevel, Tone> = {
  CRITICAL: "danger",
  HIGH: "orange",
  MEDIUM: "warning",
  INFO: "navy",
};

const LEVEL_LABEL: Record<AttentionLevel, string> = {
  CRITICAL: "Crítico",
  HIGH: "Alta",
  MEDIUM: "Média",
  INFO: "Informativo",
};

const INITIAL_VISIBLE = 7;

function AttentionRow({ item }: { item: AttentionItem }) {
  const Icon = KIND_ICON[item.kind];
  const tone = LEVEL_TONE[item.level];
  return (
    <li className={cn("grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-4 border-l-2 py-3 pl-4 pr-5", TONE_BORDER_LEFT[tone])}>
      <span className={cn("flex size-8 items-center justify-center rounded-md border border-line bg-surface-muted", TONE_TEXT[tone])}>
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-foreground">{item.title}</p>
          {item.dueDate ? (
            <DeadlineBadge dueDate={item.dueDate} />
          ) : (
            <Badge tone={tone} dot>
              {item.urgencyText}
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-muted">
          {item.context}
          {item.kind === "PROCESS_MOVEMENT" && item.at && <span className="text-subtle"> · {formatEventTime(item.at)}</span>}
        </p>
        <span className="sr-only">Prioridade {LEVEL_LABEL[item.level]}.</span>
      </div>
      <Link
        href={item.href}
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[12.5px] font-medium text-navy-700 hover:bg-navy-50 hover:text-navy"
      >
        {item.ctaLabel}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </li>
  );
}

/** "Precisa da sua atenção": itens acionáveis, mais urgentes primeiro. */
export function AttentionPanel() {
  const items = useAttentionItems();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, INITIAL_VISIBLE);
  const critical = items.filter((i) => i.level === "CRITICAL").length;

  return (
    <section
      aria-labelledby="home-attention-title"
      data-tour="home-attention"
      className="flex h-full flex-col rounded-lg border border-line bg-surface shadow-hairline"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 id="home-attention-title" className="text-[14px] font-semibold text-foreground">
            Precisa da sua atenção
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Prazos, bloqueios e pendências ordenados por urgência.</p>
        </div>
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            {critical > 0 && (
              <Badge tone="danger" dot>
                {critical} {critical === 1 ? "crítico" : "críticos"}
              </Badge>
            )}
            <Badge tone="neutral">{items.length} no total</Badge>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          compact
          icon={CheckCircle2}
          title="Nada urgente no momento"
          description="Nenhum prazo nos próximos 5 dias, análise bloqueada ou revisão parada. Novos alertas aparecem aqui automaticamente."
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {visible.map((item) => (
              <AttentionRow key={item.id} item={item} />
            ))}
          </ul>
          {items.length > INITIAL_VISIBLE && (
            <div className="mt-auto border-t border-line px-5 py-2.5">
              <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? "Mostrar menos" : `Mostrar mais ${items.length - INITIAL_VISIBLE}`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
