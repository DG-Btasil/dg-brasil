"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { Field, FormSection, Select, Textarea } from "@/components/ui/form";
import { useResponsibleOptions } from "@/features/offices/hooks";
import { useClientOriginOptions } from "../../hooks";

interface InternalValues {
  responsibleUserId: string;
  originOfficeId: string;
  legalSummary: string;
  notes: string;
}

/** Responsável e observações internas (comum a PF e PJ). */
export function InternalFields() {
  const options = useResponsibleOptions();
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<InternalValues>();
  const origin = useWatch({ control, name: "originOfficeId" });
  const originOptions = useClientOriginOptions(origin);
  return (
    <FormSection title="Informações adicionais" description="Uso interno do escritório. Não aparecem para o cliente.">
      <Field label="Responsável" requirement="required" error={errors.responsibleUserId?.message}>
        {(p) => <Select placeholder="Selecione" options={options} {...p} {...register("responsibleUserId")} />}
      </Field>
      <Field
        label="Origem do cliente"
        requirement="required"
        error={errors.originOfficeId?.message}
        hint="Escritório ao qual a entrada do cliente é atribuída. Não define a origem de processos."
      >
        {(p) => <Select placeholder="Selecione" options={originOptions} {...p} {...register("originOfficeId")} />}
      </Field>
      <Field label="Resumo jurídico" requirement="optional" hint="Síntese curta do relacionamento com o cliente." className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("legalSummary")} />}
      </Field>
      <Field label="Observações internas" requirement="optional" className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("notes")} />}
      </Field>
    </FormSection>
  );
}
