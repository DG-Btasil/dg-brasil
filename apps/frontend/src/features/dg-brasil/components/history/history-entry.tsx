import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHANGE_ENTITY_LABEL, CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import type { ChangeHistoryEntry } from "@/types";
import { formatVersionChange } from "../../utils";

interface HistoryEntryProps {
  entry: ChangeHistoryEntry;
  requestedByName: string;
  entityHref?: string;
  agents: { id: string; name: string; href: string }[];
  onShowDiff: () => void;
}

export function HistoryEntry({ entry, requestedByName, entityHref, agents, onShowDiff }: HistoryEntryProps) {
  return (
    <li id={entry.id} className="scroll-mt-24 px-5 py-4 target:bg-gold-50/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <time dateTime={entry.at} className="text-[12.5px] font-medium tabular text-foreground">
          {formatDateTime(entry.at)}
        </time>
        <StatusBadge status={entry.status} labels={CHANGE_STATUS_LABEL} tones={CHANGE_STATUS_TONE} />
        <span className="text-[12.5px] text-muted">
          {CHANGE_ENTITY_LABEL[entry.entityType]}{" "}
          {entityHref ? (
            <Link href={entityHref} className="font-medium text-navy-700 hover:underline underline-offset-2">
              {entry.entityName}
            </Link>
          ) : (
            <span className="font-medium text-foreground">{entry.entityName}</span>
          )}
        </span>
        <span className="rounded-xs border border-line bg-surface-muted px-1.5 py-0.5 text-[11.5px] tabular text-muted">
          {formatVersionChange(entry.fromVersion, entry.toVersion)}
        </span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={onShowDiff}>
          Ver alterações
        </Button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px] gap-6">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">Pedido original</h3>
          <blockquote className="mt-1 border-l-2 border-gold-300 pl-3 text-[13px] italic leading-relaxed text-foreground">“{entry.originalRequest}”</blockquote>
          <p className="mt-1 text-[12px] text-muted">Solicitado por {requestedByName}</p>
        </div>
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">Alteração sugerida</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-foreground">{entry.suggestedChange}</p>
          {entry.impact && (
            <>
              <h3 className="mt-2.5 text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">Impacto</h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{entry.impact}</p>
            </>
          )}
        </div>
        <dl className="space-y-2.5 text-[12.5px]">
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">Responsável</dt>
            <dd className="mt-0.5 text-foreground">{entry.responsible === "TUTOR_DG" ? "Tutor DG (com confirmação humana)" : requestedByName}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">Agentes afetados</dt>
            <dd className="mt-0.5">
              {agents.length === 0 ? (
                <span className="text-subtle">Nenhum</span>
              ) : (
                <ul className="space-y-0.5">
                  {agents.map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} className="inline-flex items-center gap-1 text-navy-700 hover:underline underline-offset-2">
                        {a.name} <ArrowRight aria-hidden className="size-3" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}
