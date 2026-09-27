"use client";

import { useFormContext } from "react-hook-form";
import { Field, FormSection, Select, Textarea } from "@/components/ui/form";
import { useResponsibleOptions } from "@/features/offices/hooks";

interface InternalValues {
  responsibleUserId: string;
  legalSummary: string;
  notes: string;
}

/** Responsável e observações internas (comum a PF e PJ). */
export function InternalFields() {
  const options = useResponsibleOptions();
  const {
    register,
    formState: { errors },
  } = useFormContext<InternalValues>();
  return (
    <FormSection title="Informações adicionais" description="Uso interno do escritório. Não aparecem para o cliente.">
      <Field label="Responsável" requirement="required" error={errors.responsibleUserId?.message}>
        {(p) => <Select placeholder="Selecione" options={options} {...p} {...register("responsibleUserId")} />}
      </Field>
      <div />
      <Field label="Resumo jurídico" requirement="optional" hint="Síntese curta do relacionamento com o cliente." className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("legalSummary")} />}
      </Field>
      <Field label="Observações internas" requirement="optional" className="col-span-2">
        {(p) => <Textarea rows={3} {...p} {...register("notes")} />}
      </Field>
    </FormSection>
  );
}
