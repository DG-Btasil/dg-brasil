"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Field, Input } from "@/components/ui/form";
import type { AgreementFormValues } from "../schemas";

/** Campos de valores do contrato. Somente leitura quando vêm do modelo. */
export function FeeValuesFields({
  register,
  errors,
  readOnly,
}: {
  register: UseFormRegister<AgreementFormValues>;
  errors: FieldErrors<AgreementFormValues>;
  readOnly: boolean;
}) {
  const hint = readOnly ? "Definido pelo modelo" : undefined;
  const common = { readOnly, "aria-readonly": readOnly || undefined, className: readOnly ? "bg-surface-muted text-muted" : undefined };
  return (
    <div className="grid grid-cols-3 gap-x-5 gap-y-4">
      <Field label="Entrada (R$)" requirement="optional" hint={hint ?? "Ex.: 1.500,00"} error={errors.upfrontFee?.message}>
        {(p) => <Input {...p} {...common} inputMode="decimal" placeholder="0,00" {...register("upfrontFee")} />}
      </Field>
      <Field label="Valor fixo (R$)" requirement="optional" hint={hint} error={errors.fixedFee?.message}>
        {(p) => <Input {...p} {...common} inputMode="decimal" placeholder="0,00" {...register("fixedFee")} />}
      </Field>
      <Field label="Nº de parcelas do valor fixo" requirement="optional" hint={hint} error={errors.installments?.message}>
        {(p) => <Input {...p} {...common} inputMode="numeric" placeholder="1" {...register("installments")} />}
      </Field>
      <Field label="Mensalidade (R$)" requirement="optional" hint={hint} error={errors.monthlyFee?.message}>
        {(p) => <Input {...p} {...common} inputMode="decimal" placeholder="0,00" {...register("monthlyFee")} />}
      </Field>
      <Field label="Percentual de êxito (%)" requirement="optional" hint={hint} error={errors.successFeePercent?.message}>
        {(p) => <Input {...p} {...common} inputMode="decimal" placeholder="0" {...register("successFeePercent")} />}
      </Field>
    </div>
  );
}
