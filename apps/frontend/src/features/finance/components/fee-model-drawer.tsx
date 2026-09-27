"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { BILLING_MOMENTS, BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { LEGAL_AREAS, LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import type { FeeModel } from "@/types";
import { useFinanceActions } from "../hooks";
import { feeModelSchema, feeModelToForm, formToFeeModelInput, type FeeModelFormValues } from "../schemas";

const FORM_ID = "fee-model-form";

/** Criação/edição de modelo de honorários. `model` indefinido = novo. */
export function FeeModelDrawer({ open, model, onOpenChange }: { open: boolean; model?: FeeModel; onOpenChange: (open: boolean) => void }) {
  const { saveFeeModel } = useFinanceActions();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FeeModelFormValues>({ resolver: zodResolver(feeModelSchema), defaultValues: feeModelToForm(model) });

  // Recarrega os valores ao abrir para outro modelo (sincroniza com sistema externo: o formulário).
  useEffect(() => {
    if (open) reset(feeModelToForm(model));
  }, [open, model, reset]);

  async function onSubmit(values: FeeModelFormValues) {
    const ok = await saveFeeModel(formToFeeModelInput(values), model?.id);
    if (ok) onOpenChange(false);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={620}
      title={model ? "Editar modelo de honorários" : "Novo modelo de honorários"}
      description="Os valores do modelo preenchem novos contratos e podem ser personalizados por cliente."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={FORM_ID} loading={isSubmitting}>
            {model ? "Salvar alterações" : "Criar modelo"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Nome" requirement="required" error={errors.name?.message} className="col-span-2">
            {(p) => <Input {...p} placeholder="Ex.: Bancário — Modelo A" {...register("name")} />}
          </Field>
          <Field label="Descrição" requirement="optional" className="col-span-2">
            {(p) => <Textarea {...p} rows={2} {...register("description")} />}
          </Field>
          <Field label="Área" requirement="optional">
            {(p) => <Select {...p} placeholder="Todas as áreas" options={LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }))} {...register("area")} />}
          </Field>
          <Field label="Momento da cobrança" requirement="required" error={errors.billingMoment?.message}>
            {(p) => <Select {...p} options={BILLING_MOMENTS.map((m) => ({ value: m, label: BILLING_MOMENT_LABEL[m] }))} {...register("billingMoment")} />}
          </Field>
        </div>

        <fieldset className="rounded-md border border-line px-4 pb-4 pt-2">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">Valores</legend>
          <p className="mb-3 text-[12px] text-muted">Preencha apenas o que se aplica. Valores monetários no formato 1.500,00.</p>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            <Field label="Entrada (R$)" requirement="optional" error={errors.upfrontFee?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("upfrontFee")} />}
            </Field>
            <Field label="Valor fixo (R$)" requirement="optional" error={errors.fixedFee?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("fixedFee")} />}
            </Field>
            <Field label="Parcelamento (nº de parcelas)" requirement="optional" error={errors.installments?.message}>
              {(p) => <Input {...p} inputMode="numeric" placeholder="1" {...register("installments")} />}
            </Field>
            <Field label="Mensalidade (R$)" requirement="optional" error={errors.monthlyFee?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" {...register("monthlyFee")} />}
            </Field>
            <Field label="Percentual de êxito (%)" requirement="optional" hint="Entre 0 e 100" error={errors.successFeePercent?.message}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="0" {...register("successFeePercent")} />}
            </Field>
          </div>
        </fieldset>

        <Field label="Observações" requirement="optional">
          {(p) => <Textarea {...p} rows={3} placeholder="Condições de negociação, exceções aceitas…" {...register("notes")} />}
        </Field>
        <Checkbox label="Modelo ativo" description="Modelos inativos não aparecem na criação de novos contratos." {...register("active")} />
      </form>
    </Drawer>
  );
}
