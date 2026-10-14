"use client";

import { useState } from "react";
import { BILLING_MOMENTS, BILLING_MOMENT_LABEL, type BillingMoment } from "@/lib/constants/status";
import { mapFieldErrors } from "@/lib/actions/result";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { feeModelCreateInput, feeModelPatch, feeModelToValues, type FeeModelValues, type FeeTermsValues } from "../server-input";
import { useFinanceActions } from "../use-finance-actions";

const TERM_FIELDS: { key: keyof FeeTermsValues; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: "upfrontFee", label: "Entrada (R$)", placeholder: "0,00" },
  { key: "fixedFee", label: "Valor fixo (R$)", placeholder: "0,00" },
  { key: "installments", label: "Parcelamento (nº de parcelas)", placeholder: "1", numeric: true },
  { key: "monthlyFee", label: "Mensalidade (R$)", placeholder: "0,00" },
  { key: "successFeePercent", label: "Percentual de êxito (%)", placeholder: "0" },
];

/** Criação/edição de modelo de honorários (createFeeModelAction / updateFeeModelAction). `model` indefinido = novo. */
export function FeeModelDrawer({
  model,
  areas,
  onClose,
  onSaved,
}: {
  model?: FeeModelDTO;
  areas: { value: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const actions = useFinanceActions(onSaved);
  const [values, setValues] = useState<FeeModelValues>(() => feeModelToValues(model));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FeeModelValues>(key: K, value: FeeModelValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save() {
    if (!values.name.trim()) {
      setErrors({ name: "Informe o nome do modelo." });
      return;
    }
    setSaving(true);
    const r = model ? await actions.updateFeeModel(model.id, feeModelPatch(values)) : await actions.createFeeModel(feeModelCreateInput(values));
    setSaving(false);
    if (r.ok) onClose();
    else setErrors(mapFieldErrors(r.error.fieldErrors, {}, model ? "patch." : undefined));
  }

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      width={620}
      title={model ? "Editar modelo de honorários" : "Novo modelo de honorários"}
      description="Os valores do modelo preenchem novos contratos e podem ser personalizados por caso. Contratos já criados não mudam."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button loading={saving} onClick={save}>
            {model ? "Salvar alterações" : "Criar modelo"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Nome" requirement="required" error={errors.name} className="col-span-2">
            {(p) => <Input {...p} maxLength={120} placeholder="Ex.: Bancário — Modelo A" value={values.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Descrição" requirement="optional" className="col-span-2" error={errors.description}>
            {(p) => <Textarea {...p} rows={2} maxLength={1000} value={values.description} onChange={(e) => set("description", e.target.value)} />}
          </Field>
          <Field label="Área" requirement="optional" error={errors.legalAreaId}>
            {(p) => <Select {...p} placeholder="Todas as áreas" options={areas} value={values.legalAreaId} onChange={(e) => set("legalAreaId", e.target.value)} />}
          </Field>
          <Field label="Momento da cobrança" requirement="required" error={errors.billingMoment}>
            {(p) => (
              <Select
                {...p}
                options={BILLING_MOMENTS.map((m) => ({ value: m, label: BILLING_MOMENT_LABEL[m] }))}
                value={values.billingMoment}
                onChange={(e) => set("billingMoment", e.target.value as BillingMoment)}
              />
            )}
          </Field>
        </div>
        <fieldset className="rounded-md border border-line px-4 pb-4 pt-2">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">Valores</legend>
          <p className="mb-3 text-[12px] text-muted">Preencha apenas o que se aplica. Valores monetários no formato 1.500,00.</p>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {TERM_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} requirement="optional" error={errors[f.key]}>
                {(p) => <Input {...p} inputMode={f.numeric ? "numeric" : "decimal"} placeholder={f.placeholder} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />}
              </Field>
            ))}
          </div>
        </fieldset>
        <Field label="Observações" requirement="optional" error={errors.notes}>
          {(p) => <Textarea {...p} rows={3} maxLength={2000} placeholder="Condições de negociação, exceções aceitas…" value={values.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
        <Checkbox label="Modelo ativo" description="Modelos inativos não aparecem na criação de novos contratos." checked={values.active} onChange={(e) => set("active", e.target.checked)} />
      </div>
    </Drawer>
  );
}
