"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { StepForm, StepSection } from "../components/step-section";
import { useRegisterStepForm } from "../hooks";
import { DEFAULT_STAGES } from "../labels";
import { workflowSchema, withDefaults, type WorkflowValues } from "../schemas";
import type { StepProps } from "../types";

const DEFAULTS: WorkflowValues = {
  stages: DEFAULT_STAGES.map((s) => ({ key: s.key, defaultLabel: s.label, label: s.label, used: true })),
  notes: "",
};

export function WorkflowStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<WorkflowValues>({ resolver: zodResolver(workflowSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState, setValue } = form;
  const { errors } = formState;
  const { fields } = useFieldArray({ control, name: "stages" });
  useRegisterStepForm(form, registerForm);
  const stages = useWatch({ control, name: "stages" }) ?? [];
  const inUse = stages.filter((s) => s.used);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <StepSection
        title="Sequência de trabalho"
        description="Renomeie as etapas com a nomenclatura da sua equipe e desmarque as que o escritório não usa."
        columns={1}
      >
        <div aria-label="Prévia do fluxo" className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface-muted px-3 py-2.5">
          {inUse.length === 0 && <span className="text-[12.5px] text-muted">Nenhuma etapa em uso.</span>}
          {inUse.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-[12.5px] text-foreground">
              {i > 0 && <ChevronRight className="size-3.5 text-subtle" aria-hidden />}
              <span className="font-medium">{s.label || s.defaultLabel}</span>
            </span>
          ))}
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {fields.map((f, i) => {
            const used = stages[i]?.used ?? true;
            const err = errors.stages?.[i]?.label?.message;
            return (
              <li key={f.id} className={cn("rounded-md border p-3 transition-colors", used ? "border-line-strong bg-surface" : "border-dashed border-line bg-surface-muted")}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-subtle">Etapa {i + 1}</span>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-muted">
                    <input type="checkbox" className="size-3.5 accent-navy" {...register(`stages.${i}.used`)} />
                    {used ? "Em uso" : "Não usada"}
                  </label>
                </div>
                <Field label={`Nome da etapa ${i + 1}`} error={err} className="[&_label]:sr-only">
                  {(p) => (
                    <input
                      {...p}
                      {...register(`stages.${i}.label`)}
                      readOnly={!used}
                      aria-readonly={!used || undefined}
                      className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[13px] focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25 read-only:bg-transparent read-only:text-muted aria-invalid:border-danger"
                    />
                  )}
                </Field>
                {stages[i] && stages[i].label !== f.defaultLabel && (
                  <p className="mt-1 text-[11px] text-subtle">Padrão: {f.defaultLabel}</p>
                )}
              </li>
            );
          })}
        </ol>
        {(errors.stages?.root?.message ?? errors.stages?.message) && (
          <p role="alert" className="text-[11.5px] font-medium text-danger">
            {errors.stages?.root?.message ?? errors.stages?.message}
          </p>
        )}
        <div>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="size-3.5" aria-hidden />}
            onClick={() => setValue("stages", DEFAULTS.stages, { shouldDirty: true })}
          >
            Restaurar nomes padrão
          </Button>
        </div>
      </StepSection>

      <StepSection title="Observações" columns={1}>
        <Field label="Notas sobre o fluxo" requirement="optional" hint="Ex.: revisão sempre feita pela sócia antes do protocolo." error={errors.notes?.message}>
          {(p) => <Textarea {...p} rows={3} {...register("notes")} />}
        </Field>
      </StepSection>
    </StepForm>
  );
}
