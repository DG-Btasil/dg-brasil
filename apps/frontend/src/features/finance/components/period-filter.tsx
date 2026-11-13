"use client";

import { useState } from "react";
import { useDebouncedCallback } from "@/lib/hooks/use-server-list";
import { Input } from "@/components/ui/form";
import { periodProblem } from "../list-query";

/**
 * Filtro "de / até" das listas do Financeiro (datas civis). Só consulta o
 * servidor com um período coerente: "de" depois de "até" mostra o aviso e não
 * dispara nada. A consulta espera a digitação terminar (o campo de data emite
 * um valor a cada dígito do ano). Quando o período aplicado muda por fora
 * ("Limpar filtros", dados novos do servidor), os campos acompanham.
 */
export function PeriodFilter({
  label,
  from,
  to,
  max,
  onChange,
}: {
  /** O que o período filtra (ex.: "Vencimento"). Vai no rótulo dos dois campos. */
  label: string;
  from: string;
  to: string;
  /** Última data permitida (ex.: hoje, em listas de fatos passados). */
  max?: string;
  onChange: (from: string, to: string) => void;
}) {
  const [draft, setDraft] = useState({ from, to });
  const [applied, setApplied] = useState({ from, to });
  if (applied.from !== from || applied.to !== to) {
    setApplied({ from, to });
    setDraft({ from, to });
  }
  const commit = useDebouncedCallback((next: { from: string; to: string }) => onChange(next.from, next.to), 500);
  const problem = periodProblem(draft.from, draft.to);

  function change(next: { from: string; to: string }) {
    setDraft(next);
    if (!periodProblem(next.from, next.to)) commit(next);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="whitespace-nowrap text-[12px] text-muted">{label}</span>
        <Input type="date" aria-label={`${label}: de`} aria-invalid={problem ? true : undefined} max={max} className="h-9 w-[150px]" value={draft.from} onChange={(e) => change({ ...draft, from: e.target.value })} />
        <span className="text-[12px] text-muted">até</span>
        <Input type="date" aria-label={`${label}: até`} aria-invalid={problem ? true : undefined} max={max} className="h-9 w-[150px]" value={draft.to} onChange={(e) => change({ ...draft, to: e.target.value })} />
      </div>
      {problem && (
        <p role="alert" className="text-[12px] text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
