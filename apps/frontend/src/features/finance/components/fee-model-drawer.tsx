"use client";

import { useState } from "react";
import { BILLING_MOMENT_LABEL, type BillingMoment } from "@/lib/constants/status";
import { mapFieldErrors } from "@/lib/actions/result";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { Checkbox, ChoiceCards, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import {
  FEE_BILLING_TYPES,
  FEE_BILLING_TYPE_META,
  feeModelCreateInput,
  feeModelMissingFields,
  feeModelPatch,
  feeModelToValues,
  withBillingType,
  type FeeBillingType,
  type FeeModelValues,
  type FeeTermsValues,
} from "../server-input";
import { useFinanceActions } from "../use-finance-actions";

/** Rótulo de cada valor; o parcelado chama o valor fixo de "total". */
function termField(key: keyof FeeTermsValues, type: FeeBillingType): { label: string; placeholder: string; numeric?: boolean } {
  switch (key) {
    case "upfrontFee":
      return { label: "Entrada (R$)", placeholder: "0,00" };
    case "fixedFee":
      return { label: type === "INSTALLMENTS" ? "Valor total (R$)" : "Valor (R$)", placeholder: "0,00" };
    case "installments":
      return { label: "Número de parcelas", placeholder: "2", numeric: true };
    case "monthlyFee":
      return { label: "Mensalidade (R$)", placeholder: "0,00" };
    case "successFeePercent":
      return { label: "Percentual de êxito (%)", placeholder: "30" };
  }
}

const TYPE_OPTIONS = FEE_BILLING_TYPES.map((t) => ({ value: t, label: FEE_BILLING_TYPE_META[t].label, description: FEE_BILLING_TYPE_META[t].description }));

/**
 * Criação/edição de modelo de honorários (createFeeModelAction /
 * updateFeeModelAction). Primeiro o TIPO de cobrança; depois só os valores que
 * ele usa (os demais são limpos ao salvar). `model` indefinido = novo.
 */
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
  // Detalhes abertos de início só se o modelo já os tem (valor fixo: o usuário abre/fecha depois).
  const [detailsOpen] = useState(() => !!(model?.description || model?.legalAreaId || model?.notes));
  const set = <K extends keyof FeeModelValues>(key: K, value: FeeModelValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const meta = FEE_BILLING_TYPE_META[values.billingType];
  // Modelo antigo fora dos tipos: o cartão "Personalizado" aparece só para ele.
  const options = values.billingType === "CUSTOM" || feeModelToValues(model).billingType === "CUSTOM" ? [...TYPE_OPTIONS, { value: "CUSTOM" as const, label: FEE_BILLING_TYPE_META.CUSTOM.label, description: FEE_BILLING_TYPE_META.CUSTOM.description }] : TYPE_OPTIONS;

  async function save() {
    const missing = feeModelMissingFields(values) as Record<string, string>;
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
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
      width={640}
      title={model ? "Editar modelo de honorários" : "Novo modelo de honorários"}
      description="O modelo preenche novos contratos (que podem ser personalizados por processo). Contratos já criados não mudam."
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
      <div className="space-y-6">
        <Field label="Nome" requirement="required" error={errors.name}>
          {(p) => <Input {...p} maxLength={120} placeholder="Ex.: Bancário — 30% no êxito" value={values.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>

        <section aria-labelledby="fee-type-title">
          <h3 id="fee-type-title" className="mb-1 text-[12.5px] font-semibold text-foreground">
            Tipo de cobrança
          </h3>
          <p className="mb-3 text-[12px] text-muted">Escolha primeiro como o escritório cobra; o formulário pede só os valores desse tipo.</p>
          {/* ChoiceCards põe todas as opções numa linha (estilo inline); aqui, 3 por linha. */}
          <ChoiceCards<FeeBillingType>
            name="fee-billing-type"
            legend="Tipo de cobrança"
            value={values.billingType}
            onChange={(t) => {
              setValues((v) => withBillingType(v, t));
              setErrors({});
            }}
            options={options}
            className="[&>div]:grid-cols-3!"
          />
        </section>

        <fieldset className="rounded-md border border-line px-4 pb-4 pt-2">
          <legend className="px-1 text-[12.5px] font-semibold text-foreground">Valores — {meta.label}</legend>
          <p className="mb-3 text-[12px] text-muted">
            {values.billingType === "CUSTOM" ? "Preencha apenas o que se aplica." : "Os valores de outros tipos são limpos ao salvar."} Valores monetários no formato 1.500,00.
          </p>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4">
            {meta.fields.map((key) => {
              const f = termField(key, values.billingType);
              return (
                <Field key={key} label={f.label} requirement={values.billingType === "CUSTOM" ? "optional" : "required"} error={errors[key]}>
                  {(p) => <Input {...p} inputMode={f.numeric ? "numeric" : "decimal"} placeholder={f.placeholder} value={values[key]} onChange={(e) => set(key, e.target.value)} />}
                </Field>
              );
            })}
            {meta.moments.length > 1 ? (
              <Field label="Quando cobrar" requirement="required" error={errors.billingMoment}>
                {(p) => (
                  <Select
                    {...p}
                    options={meta.moments.map((m) => ({ value: m, label: BILLING_MOMENT_LABEL[m] }))}
                    value={values.billingMoment}
                    onChange={(e) => set("billingMoment", e.target.value as BillingMoment)}
                  />
                )}
              </Field>
            ) : (
              <p className="self-end pb-2 text-[12px] text-muted">Cobrança: {BILLING_MOMENT_LABEL[meta.moments[0]].toLowerCase()}.</p>
            )}
          </div>
        </fieldset>

        <details className="group rounded-md border border-line px-4 py-2" open={detailsOpen}>
          <summary className="cursor-pointer text-[12.5px] font-medium text-foreground">Mais detalhes (opcional)</summary>
          <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4 pb-2">
            <Field label="Área" requirement="optional" error={errors.legalAreaId}>
              {(p) => <Select {...p} placeholder="Todas as áreas" options={areas} value={values.legalAreaId} onChange={(e) => set("legalAreaId", e.target.value)} />}
            </Field>
            <div />
            <Field label="Descrição" requirement="optional" className="col-span-2" error={errors.description}>
              {(p) => <Textarea {...p} rows={2} maxLength={1000} value={values.description} onChange={(e) => set("description", e.target.value)} />}
            </Field>
            <Field label="Observações" requirement="optional" className="col-span-2" error={errors.notes}>
              {(p) => <Textarea {...p} rows={2} maxLength={2000} placeholder="Condições de negociação, exceções aceitas…" value={values.notes} onChange={(e) => set("notes", e.target.value)} />}
            </Field>
          </div>
        </details>

        <Checkbox label="Modelo ativo" description="Modelos inativos não aparecem na criação de novos contratos." checked={values.active} onChange={(e) => set("active", e.target.checked)} />
      </div>
    </Drawer>
  );
}
