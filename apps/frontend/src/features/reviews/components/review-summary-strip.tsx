"use client";

import { useCallback, useRef, useState } from "react";
import { AlarmClock, Flame, Inbox, UserX, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { getReviewSummaryAction } from "@/server/domain/reviews/actions";
import type { ReviewSummaryDTO } from "@/server/domain/reviews/dto";
import { isReviewCounterActive, type ReviewCounter, type ReviewListQuery } from "../list-query";

const COUNTERS: { key: ReviewCounter; label: string; icon: LucideIcon; emphasis?: boolean }[] = [
  { key: "open", label: "Aguardando decisão", icon: Inbox },
  { key: "topPriority", label: "Urgentes e alta prioridade", icon: Flame, emphasis: true },
  { key: "dueSoon", label: "Vencendo em até 7 dias (inclui vencidas)", icon: AlarmClock, emphasis: true },
  { key: "unassigned", label: "Sem responsável", icon: UserX },
];

/**
 * Indicadores da fila no modelo de ProcessSummaryStrip — contados no BANCO
 * para a fila inteira (revisões em aberto, RLS de quem vê). Os três filtros
 * aplicam na URL e, clicados de novo, limpam (aria-pressed). "Aguardando
 * decisão" mostra a fila em aberto inteira: marcado (aria-current) quando a
 * lista é exatamente essa.
 */
export function ReviewSummaryStrip({ summary, query, onToggle }: { summary: ReviewSummaryDTO; query: ReviewListQuery; onToggle: (counter: ReviewCounter) => void }) {
  return (
    <section aria-label="Resumo da fila de revisões" className="mb-4 grid grid-cols-4 divide-x divide-line rounded-lg border border-line bg-surface shadow-hairline">
      {COUNTERS.map(({ key, label, icon: Icon, emphasis }) => {
        const value = summary[key];
        const pressed = isReviewCounterActive(query, key);
        const isAll = key === "open";
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isAll ? undefined : pressed}
            aria-current={isAll && pressed ? "true" : undefined}
            onClick={() => onToggle(key)}
            title={
              isAll
                ? pressed
                  ? "A lista mostra todas as revisões aguardando decisão"
                  : "Clique para ver todas as revisões aguardando decisão (limpa os filtros)"
                : pressed
                  ? "Clique para limpar este filtro"
                  : "Clique para filtrar a lista"
            }
            className={cn(
              "flex items-center gap-3 px-5 py-3 text-left transition-colors first:rounded-l-lg last:rounded-r-lg hover:bg-surface-muted",
              pressed && "bg-navy-50 shadow-[inset_0_-2px_0_var(--navy-900)] hover:bg-navy-50",
            )}
          >
            <Icon aria-hidden className={cn("size-4 shrink-0", emphasis && value > 0 ? "text-orange" : pressed ? "text-navy" : "text-subtle")} />
            <span className="min-w-0">
              <span className="block text-[18px] font-semibold leading-none tabular text-navy">{formatNumber(value)}</span>
              <span className="mt-1 block text-[11.5px] text-muted">{label}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

/**
 * Indicadores com o valor inicial do servidor. `refresh` reconta (a fila pode
 * ter mudado desde o carregamento); resposta antiga nunca sobrescreve a nova,
 * e falha mantém os números anteriores. Dados novos do servidor
 * (router.refresh) substituem os locais.
 */
export function useReviewSummary(initial: ActionResult<ReviewSummaryDTO> | undefined) {
  const [summary, setSummary] = useState(initial);
  const [base, setBase] = useState(initial);
  if (base !== initial) {
    setBase(initial);
    setSummary(initial);
  }
  const seq = useRef(0);
  const refresh = useCallback(() => {
    const id = ++seq.current;
    void callAction(() => getReviewSummaryAction()).then((r) => {
      if (id === seq.current && r.ok) setSummary(r);
    });
  }, []);
  return { summary, refresh };
}
