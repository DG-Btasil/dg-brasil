"use client";

import { Landmark, Lock, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChoiceCards } from "@/components/ui/form";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import type { AnalysisTemplate } from "@/types";

export function StepTemplate({ templates, value, onChange }: { templates: AnalysisTemplate[]; value: string | undefined; onChange: (id: string) => void }) {
  const active = templates.filter((t) => t.active);
  const inactive = templates.filter((t) => !t.active);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Área e tipo de análise</h2>
        <p className="mt-0.5 text-[13px] text-muted">Cada modelo define os documentos exigidos, os dados a coletar e o agente responsável.</p>
      </div>
      {active.length > 0 ? (
        <ChoiceCards
          name="analysis-template"
          legend="Modelo de análise"
          value={value}
          onChange={onChange}
          className="max-w-[900px]"
          options={active.map((t) => ({
            value: t.id,
            label: `${t.name} · ${LEGAL_AREA_LABEL[t.area]}`,
            description: t.description,
            icon: t.area === "BANKING" ? <Landmark className="size-5" aria-hidden /> : <ShoppingBag className="size-5" aria-hidden />,
          }))}
        />
      ) : (
        <p className="text-[13px] text-muted">Nenhum modelo de análise está ativo neste escritório.</p>
      )}
      {inactive.length > 0 && (
        <div className="max-w-[900px]">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-[0.06em] text-subtle">Outras áreas</p>
          <ul className="grid grid-cols-2 gap-3">
            {inactive.map((t) => (
              <li key={t.id} className="flex cursor-not-allowed items-start gap-3 rounded-lg border border-dashed border-line-strong bg-surface-muted p-4 opacity-80">
                <Lock className="mt-0.5 size-4 text-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-muted">
                    {t.name} · {LEGAL_AREA_LABEL[t.area]}
                    <span className="sr-only"> (indisponível)</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted">{t.description}</p>
                  <Badge tone="neutral" className="mt-2">
                    Disponível após configuração da área
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
