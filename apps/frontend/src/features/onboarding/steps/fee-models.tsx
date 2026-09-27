"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import { Info, Plus, Trash2 } from "lucide-react";
import { BILLING_MOMENTS, BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { StepForm, StepSection } from "../components/step-section";
import { useOnboardingActions, useRegisterStepForm, useToast } from "../hooks";
import { feeModelsSchema, withDefaults, type FeeModelsValues } from "../schemas";
import type { StepProps } from "../types";

const MOMENT_OPTIONS = BILLING_MOMENTS.map((m) => ({ value: m, label: BILLING_MOMENT_LABEL[m] }));
const EMPTY: FeeModelsValues["models"][number] = {
  createdId: "",
  name: "",
  description: "",
  upfrontFee: "",
  fixedFee: "",
  installments: "",
  monthlyFee: "",
  successFeePercent: "",
  billingMoment: "ON_SIGNING",
};

export function FeeModelsStep({ formId, answers, onSave, registerForm }: StepProps) {
  const toast = useToast();
  const { createFeeModels } = useOnboardingActions();
  const form = useForm<FeeModelsValues>({ resolver: zodResolver(feeModelsSchema), defaultValues: withDefaults({ models: [EMPTY] }, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  const list = useFieldArray({ control, name: "models" });
  useRegisterStepForm(form, registerForm);

  const submit = handleSubmit(async (values) => {
    const { models, created } = await createFeeModels(values.models);
    if (created > 0) toast({ tone: "success", title: created === 1 ? "1 modelo de honorários criado" : `${created} modelos de honorários criados` });
    await onSave({ models });
  });

  return (
    <StepForm id={formId} onSubmit={submit}>
      <p className="flex items-start gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-[12px] text-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Os modelos podem ser gerenciados depois em Configurações › Honorários. Valores visíveis apenas para quem acessa o Financeiro.
      </p>

      <StepSection title="Modelos iniciais" columns={1}>
        <ol className="space-y-4">
          {list.fields.map((f, i) => {
            const e = errors.models?.[i];
            const saved = Boolean(f.createdId);
            return (
              <li key={f.id} className="rounded-md border border-line p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                    Modelo {i + 1}
                    {saved && <Badge tone="success" dot>Criado</Badge>}
                  </p>
                  {!saved && (
                    <IconButton label={`Remover modelo ${i + 1}`} size="sm" onClick={() => list.remove(i)}>
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </div>
                {saved ? (
                  <p className="text-[12.5px] text-foreground">
                    {f.name} · {BILLING_MOMENT_LABEL[f.billingMoment]}
                    {f.description ? <span className="text-muted"> — {f.description}</span> : null}
                  </p>
                ) : (
                <fieldset className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <legend className="sr-only">Dados do modelo {i + 1}</legend>
                  <Field label="Nome" requirement="required" error={e?.name?.message}>
                    {(p) => <Input {...p} placeholder="Ex.: Revisional bancária — padrão" {...register(`models.${i}.name`)} />}
                  </Field>
                  <Field label="Momento da cobrança" requirement="required" error={e?.billingMoment?.message}>
                    {(p) => <Select {...p} options={MOMENT_OPTIONS} {...register(`models.${i}.billingMoment`)} />}
                  </Field>
                  <Field label="Descrição" requirement="optional" className="sm:col-span-2" error={e?.description?.message}>
                    {(p) => <Input {...p} {...register(`models.${i}.description`)} />}
                  </Field>
                  <Field label="Entrada (R$)" requirement="optional" error={e?.upfrontFee?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register(`models.${i}.upfrontFee`)} />}
                  </Field>
                  <Field label="Valor fixo (R$)" requirement="optional" error={e?.fixedFee?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register(`models.${i}.fixedFee`)} />}
                  </Field>
                  <Field label="Parcelas" requirement="optional" error={e?.installments?.message}>
                    {(p) => <Input {...p} inputMode="numeric" placeholder="Ex.: 6" {...register(`models.${i}.installments`)} />}
                  </Field>
                  <Field label="Mensalidade (R$)" requirement="optional" error={e?.monthlyFee?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register(`models.${i}.monthlyFee`)} />}
                  </Field>
                  <Field label="Êxito (%)" requirement="optional" error={e?.successFeePercent?.message}>
                    {(p) => <Input {...p} inputMode="decimal" placeholder="Ex.: 30" {...register(`models.${i}.successFeePercent`)} />}
                  </Field>
                </fieldset>
                )}
                {saved && <p className="mt-2 text-[11.5px] text-muted">Já criado. Para alterar, use Configurações › Honorários.</p>}
              </li>
            );
          })}
        </ol>
        <div>
          <Button variant="secondary" size="sm" onClick={() => list.append(EMPTY)} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar modelo
          </Button>
        </div>
      </StepSection>
    </StepForm>
  );
}
