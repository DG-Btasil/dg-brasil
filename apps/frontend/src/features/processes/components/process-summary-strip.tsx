"use client";

import { AlarmClock, Briefcase, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/formatting";
import type { ProcessSummaryDTO } from "@/server/domain/processes/dto";

function Counter({ icon: Icon, label, value, emphasis, onClick }: { icon: LucideIcon; label: string; value: number; emphasis?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <Icon aria-hidden className={cn("size-4", emphasis && value > 0 ? "text-orange" : "text-subtle")} />
      <div className="text-left">
        <div className="text-[18px] font-semibold leading-none tabular text-navy">{formatNumber(value)}</div>
        <div className="mt-1 text-[11.5px] text-muted">{label}</div>
      </div>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-muted">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-5 py-3">{body}</div>
  );
}

/** Contadores discretos acima da tabela — contados no BANCO para a carteira inteira (não só a página). */
export function ProcessSummaryStrip({ summary, onDueSoon }: { summary: ProcessSummaryDTO; onDueSoon?: () => void }) {
  return (
    <section aria-label="Resumo da carteira de processos" className="mb-4 grid grid-cols-4 divide-x divide-line rounded-lg border border-line bg-surface shadow-hairline">
      <Counter icon={Briefcase} label="Processos ativos" value={summary.active} />
      <Counter icon={AlarmClock} label="Com prazo em até 5 dias (inclui vencidos)" value={summary.dueSoon} emphasis onClick={onDueSoon} />
      <Counter icon={Sparkles} label="Criados pelo DG Brasil" value={summary.agent} />
      <Counter icon={RefreshCw} label="Importados por integração" value={summary.imported} />
    </section>
  );
}
