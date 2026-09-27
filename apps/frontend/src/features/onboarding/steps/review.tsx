"use client";

import { CheckCircle2, CircleDashed, CornerDownRight, Pencil } from "lucide-react";
import { nowISO } from "@/lib/clock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUserMap } from "@/features/offices/hooks";
import { ONBOARDING_STEPS } from "../config";
import { useOnboardingState } from "../hooks";
import { summarizeStep } from "../review-summary";
import type { StepProps } from "../types";

export function ReviewStep({ formId, onSave, goToStep }: StepProps) {
  const onboarding = useOnboardingState();
  const users = useUserMap();
  const userName = (id: string) => users.get(id)?.name ?? "Usuário removido";
  const steps = ONBOARDING_STEPS.slice(0, -1);
  const skipped = steps.filter((s) => onboarding.skippedSteps.includes(s.key)).length;
  const pending = steps.filter((s) => !onboarding.completedSteps.includes(s.key) && !onboarding.skippedSteps.includes(s.key)).length;

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ reviewedAt: nowISO() });
      }}
      className="space-y-5"
    >
      <p className="text-[12.5px] leading-relaxed text-muted">
        {skipped + pending === 0
          ? "Todas as etapas foram respondidas."
          : `${skipped} etapa(s) pulada(s) e ${pending} sem resposta. Elas podem ser configuradas depois, sem impedir a finalização.`}
      </p>

      <ol className="divide-y divide-line rounded-md border border-line">
        {steps.map((step, i) => {
          const isSkipped = onboarding.skippedSteps.includes(step.key);
          const isDone = onboarding.completedSteps.includes(step.key);
          const items = isDone ? summarizeStep(step.key, onboarding.answers[step.key], userName) : [];
          return (
            <li key={step.key} className="px-4 py-3.5">
              <div className="flex items-center gap-3">
                <span className="w-5 text-[11.5px] tabular text-subtle" aria-hidden>
                  {i + 1}.
                </span>
                <h3 className="flex-1 text-[13px] font-semibold text-foreground">{step.title}</h3>
                {isDone && (
                  <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>
                    Respondida
                  </Badge>
                )}
                {isSkipped && (
                  <Badge tone="neutral" icon={<CornerDownRight className="size-3" aria-hidden />}>
                    Pulada — pode ser configurada depois
                  </Badge>
                )}
                {!isDone && !isSkipped && (
                  <Badge tone="warning" icon={<CircleDashed className="size-3" aria-hidden />}>
                    Sem resposta
                  </Badge>
                )}
                <Button variant="ghost" size="sm" onClick={() => goToStep(i)} icon={<Pencil className="size-3.5" aria-hidden />} aria-label={`Editar ${step.title}`}>
                  Editar
                </Button>
              </div>
              {items.length > 0 && (
                <dl className="ml-8 mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-[160px_minmax(0,1fr)]">
                  {items.map((it) => (
                    <div key={it.label} className="contents">
                      <dt className="text-[11.5px] font-medium uppercase tracking-[0.05em] text-subtle">{it.label}</dt>
                      <dd className="break-words text-[12.5px] text-foreground">{it.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ol>

      <p className="rounded-md border border-line bg-surface-muted px-3.5 py-2.5 text-[12px] leading-relaxed text-muted">
        Ao finalizar, as escolhas da etapa &quot;Agentes e Skills&quot; são aplicadas (ativação e autonomia de cada agente) e a implantação é marcada
        como concluída. Tudo pode ser revisado depois.
      </p>
    </form>
  );
}
