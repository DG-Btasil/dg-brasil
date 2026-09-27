"use client";

import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import { Plus, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, MaskedInput } from "@/components/ui/form";
import { newRepresentative, type CompanyFormValues } from "../../schemas";

/** Representação legal (ao menos um, exatamente um principal). */
export function RepresentativesFields() {
  const {
    register,
    control,
    setValue,
    formState: { errors },
  } = useFormContext<CompanyFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name: "representatives", keyName: "key" });
  const values = useWatch({ control, name: "representatives" });
  const listError = errors.representatives?.root?.message ?? errors.representatives?.message;

  function makePrimary(index: number) {
    fields.forEach((_, i) => setValue(`representatives.${i}.isPrimary`, i === index, { shouldValidate: true }));
  }

  function removeAt(index: number) {
    const wasPrimary = values?.[index]?.isPrimary;
    remove(index);
    if (wasPrimary) setValue("representatives.0.isPrimary", true, { shouldValidate: true });
  }

  return (
    <section className="grid grid-cols-[240px_minmax(0,1fr)] gap-8 border-b border-line py-7">
      <div>
        <h3 className="text-[13.5px] font-semibold text-foreground">Representação</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Quem assina pela empresa. Ao menos um representante é obrigatório; marque o principal.
        </p>
      </div>
      <div className="space-y-3">
        {fields.map((field, index) => {
          const e = errors.representatives?.[index];
          const primary = values?.[index]?.isPrimary;
          return (
            <fieldset key={field.key} className="rounded-md border border-line bg-surface-muted/50 p-4">
              <legend className="sr-only">Representante {index + 1}</legend>
              <div className="mb-3 flex items-center justify-between">
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
                  Representante {index + 1}
                  {primary && (
                    <Badge tone="navy" icon={<Star className="size-3" aria-hidden />}>
                      Principal
                    </Badge>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  {!primary && (
                    <Button variant="ghost" size="sm" onClick={() => makePrimary(index)}>
                      Marcar como principal
                    </Button>
                  )}
                  {fields.length > 1 && (
                    <IconButton label={`Remover representante ${index + 1}`} size="sm" onClick={() => removeAt(index)}>
                      <Trash2 className="size-4" aria-hidden />
                    </IconButton>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-x-5 gap-y-4">
                <Field label="Nome" requirement="required" error={e?.name?.message}>
                  {(p) => <Input {...p} {...register(`representatives.${index}.name`)} />}
                </Field>
                <Field label="CPF" requirement="required" error={e?.cpf?.message}>
                  {(p) => <MaskedInput mask="cpf" placeholder="000.000.000-00" {...p} {...register(`representatives.${index}.cpf`)} />}
                </Field>
                <Field label="Cargo" requirement="required" error={e?.role?.message}>
                  {(p) => <Input placeholder="Ex.: Sócio-administrador" {...p} {...register(`representatives.${index}.role`)} />}
                </Field>
                <Field label="E-mail" requirement="optional" error={e?.email?.message}>
                  {(p) => <Input type="email" {...p} {...register(`representatives.${index}.email`)} />}
                </Field>
                <Field label="Telefone" requirement="optional" error={e?.phone?.message}>
                  {(p) => <MaskedInput mask="phone" placeholder="(00) 00000-0000" {...p} {...register(`representatives.${index}.phone`)} />}
                </Field>
              </div>
            </fieldset>
          );
        })}
        {listError && (
          <p role="alert" className="text-[11.5px] font-medium text-danger">
            {listError}
          </p>
        )}
        <Button variant="secondary" size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => append(newRepresentative(fields.length === 0))}>
          Adicionar representante
        </Button>
      </div>
    </section>
  );
}
