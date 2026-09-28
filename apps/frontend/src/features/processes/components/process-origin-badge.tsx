"use client";

import { FileSpreadsheet, PenLine, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { PROCESS_ORIGIN_DESCRIPTION, PROCESS_ORIGIN_LABEL, type ProcessOrigin } from "@/lib/constants/status";
import { Tooltip } from "@/components/ui/tooltip";

const ICON = { AGENT: Sparkles, INTEGRATION: RefreshCw, MANUAL: PenLine, IMPORT: FileSpreadsheet } as const;

const STYLE: Record<ProcessOrigin, string> = {
  AGENT: "border-gold-100 bg-gold-50 text-navy font-semibold",
  INTEGRATION: "border-line bg-surface text-muted",
  MANUAL: "border-transparent bg-transparent text-subtle",
  IMPORT: "border-line bg-surface text-muted",
};

/**
 * Origem do processo: DG Brasil (destaque dourado), Integração (discreto)
 * ou Manual. Ícone + texto, com descrição em tooltip.
 */
export function ProcessOriginBadge({ origin, className }: { origin: ProcessOrigin; className?: string }) {
  const Icon = ICON[origin];
  return (
    <Tooltip content={PROCESS_ORIGIN_DESCRIPTION[origin]}>
      <span
        tabIndex={0}
        aria-label={`Origem: ${PROCESS_ORIGIN_LABEL[origin]}. ${PROCESS_ORIGIN_DESCRIPTION[origin]}`}
        className={cn(
          "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-xs border px-1.5 text-[11.5px] font-medium leading-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40",
          STYLE[origin],
          className,
        )}
      >
        <Icon aria-hidden className={cn("size-3", origin === "AGENT" && "text-gold-600")} />
        {PROCESS_ORIGIN_LABEL[origin]}
      </span>
    </Tooltip>
  );
}
