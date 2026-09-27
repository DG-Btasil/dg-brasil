"use client";

import { useMemo } from "react";
import { AlarmClock, Briefcase, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { daysUntil } from "@/lib/clock";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/formatting";
import { INACTIVE_PROCESS_STATUSES, type ProcessRow } from "../utils";

function Counter({ icon: Icon, label, value, emphasis }: { icon: LucideIcon; label: string; value: number; emphasis?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <Icon aria-hidden className={cn("size-4", emphasis && value > 0 ? "text-orange" : "text-subtle")} />
      <div>
        <div className="text-[18px] font-semibold leading-none tabular text-navy">{formatNumber(value)}</div>
        <div className="mt-1 text-[11.5px] text-muted">{label}</div>
      </div>
    </div>
  );
}

/** Contadores discretos acima da tabela de processos. */
export function ProcessSummaryStrip({ rows }: { rows: ProcessRow[] }) {
  const counts = useMemo(() => {
    let active = 0;
    let soon = 0;
    let agent = 0;
    let imported = 0;
    for (const { process, nextDeadline } of rows) {
      if (!INACTIVE_PROCESS_STATUSES.includes(process.status)) active += 1;
      if (nextDeadline && daysUntil(nextDeadline.dueDate) <= 5) soon += 1;
      if (process.origin === "AGENT") agent += 1;
      if (process.origin === "INTEGRATION") imported += 1;
    }
    return { active, soon, agent, imported };
  }, [rows]);

  return (
    <section aria-label="Resumo da carteira de processos" className="mb-4 grid grid-cols-4 divide-x divide-line rounded-lg border border-line bg-surface shadow-hairline">
      <Counter icon={Briefcase} label="Processos ativos" value={counts.active} />
      <Counter icon={AlarmClock} label="Com prazo em até 5 dias (inclui vencidos)" value={counts.soon} emphasis />
      <Counter icon={Sparkles} label="Criados pelo DG Brasil" value={counts.agent} />
      <Counter icon={RefreshCw} label="Importados por integração" value={counts.imported} />
    </section>
  );
}
