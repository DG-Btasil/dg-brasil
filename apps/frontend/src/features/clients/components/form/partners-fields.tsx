"use client";

import { useFieldArray, useFormContext } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, MaskedInput } from "@/components/ui/form";
import { newPartner, type CompanyFormValues } from "../../schemas";

/** Quadro societário (QSA) — opcional. */
export function PartnersFields() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<CompanyFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "partners", keyName: "key" });

  return (
    <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 border-b border-line py-7">
      <div>
        <h3 className="text-[13.5px] font-semibold text-foreground">Quadro societário (QSA)</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Opcional. Informe apenas se for relevante para o caso.</p>
      </div>
      <div className="space-y-3">
        {fields.length === 0 && <p className="text-[12.5px] text-muted">Nenhum sócio informado.</p>}
        {fields.map((field, index) => {
          const e = errors.partners?.[index];
          return (
            <fieldset key={field.key} className="grid grid-cols-[1.4fr_1fr_1fr_0.6fr_auto] items-start gap-x-4 rounded-md border border-line p-4">
              <legend className="sr-only">Sócio {index + 1}</legend>
              <Field label="Nome" requirement="required" error={e?.name?.message}>
                {(p) => <Input {...p} {...register(`partners.${index}.name`)} />}
              </Field>
              <Field label="CPF/CNPJ" requirement="optional" error={e?.document?.message}>
                {(p) => <MaskedInput mask="document" placeholder="000.000.000-00" {...p} {...register(`partners.${index}.document`)} />}
              </Field>
              <Field label="Qualificação" requirement="optional">
                {(p) => <Input placeholder="Ex.: Sócio" {...p} {...register(`partners.${index}.qualification`)} />}
              </Field>
              <Field label="Participação (%)" requirement="optional" error={e?.sharePercent?.message}>
                {(p) => <Input inputMode="decimal" placeholder="0" {...p} {...register(`partners.${index}.sharePercent`)} />}
              </Field>
              <IconButton label={`Remover sócio ${index + 1}`} size="sm" className="mt-6" onClick={() => remove(index)}>
                <Trash2 className="size-4" aria-hidden />
              </IconButton>
            </fieldset>
          );
        })}
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => append(newPartner())}>
          Adicionar sócio
        </Button>
      </div>
    </section>
  );
}
