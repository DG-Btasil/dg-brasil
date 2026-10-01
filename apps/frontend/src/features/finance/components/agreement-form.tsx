"use client";

import { useMemo, type ChangeEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilLine, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { todayISO } from "@/lib/clock";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import type { ID } from "@/types";
import { useCaseValue, useClientCasesForFinance, useClientOptions, useFeeModels, useFinanceActions } from "../hooks";
import { agreementSchema, feeModelToFeeFields, formToFeeValues, type AgreementFormValues } from "../schemas";
import { caseLabel } from "../utils";
import { FeeValuesFields } from "./fee-values-fields";
import { SchedulePreview } from "./schedule-preview";

interface AgreementFormProps {
  /** Cliente fixo (ex.: aba Financeiro do caso). */
  fixedClientId?: ID;
  /** Caso fixo (ex.: aba Financeiro do caso). */
  fixedCaseId?: ID;
  defaultClientId?: ID;
  defaultCaseId?: ID;
  onCreated?: (id: ID) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * Contrato de honorários. O modelo escolhido preenche os valores (somente
 * leitura); "Personalizar para este cliente" libera a edição. Nenhuma regra
 * de cobrança é imposta: cada escritório define seus próprios modelos.
 */
export function AgreementForm({ fixedClientId, fixedCaseId, defaultClientId, defaultCaseId, onCreated, onCancel, submitLabel = "Criar contrato" }: AgreementFormProps) {
  const feeModels = useFeeModels();
  const clientOptions = useClientOptions();
  const { createAgreement } = useFinanceActions();

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AgreementFormValues>({
    resolver: zodResolver(agreementSchema),
    defaultValues: {
      clientId: fixedClientId ?? defaultClientId ?? "",
      legalCaseId: fixedCaseId ?? defaultCaseId ?? "",
      feeModelId: "",
      customized: true,
      ...feeModelToFeeFields(undefined),
      startDate: todayISO(),
      notes: "",
    },
  });

  const values = useWatch({ control });
  const clientCases = useClientCasesForFinance(values.clientId);
  const caseValue = useCaseValue(values.legalCaseId);
  const selectedModel = feeModels.find((m) => m.id === values.feeModelId);
  const readOnly = Boolean(selectedModel) && !values.customized;

  const modelOptions = useMemo(
    () => feeModels.filter((m) => m.active || m.id === values.feeModelId).map((m) => ({ value: m.id, label: m.name })),
    [feeModels, values.feeModelId],
  );

  function applyModel(id: string) {
    const model = feeModels.find((m) => m.id === id);
    const fields = feeModelToFeeFields(model);
    (Object.keys(fields) as (keyof typeof fields)[]).forEach((key) => setValue(key, fields[key], { shouldValidate: true }));
    setValue("customized", !model);
  }

  async function onSubmit(data: AgreementFormValues) {
    const fee = formToFeeValues(data);
    const id = await createAgreement({
      clientId: data.clientId,
      legalCaseId: data.legalCaseId,
      feeModelId: data.feeModelId || undefined,
      customized: data.customized,
      upfrontFee: fee.upfrontFee,
      fixedFee: fee.fixedFee,
      installments: fee.fixedFee > 0 ? fee.installments : 0,
      monthlyFee: fee.monthlyFee,
      successFeePercent: fee.successFeePercent,
      startDate: data.startDate,
      notes: data.notes || undefined,
    });
    if (id) onCreated?.(id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {!fixedClientId && (
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Cliente" requirement="required" error={errors.clientId?.message}>
            {(p) => (
              <Select
                {...p}
                placeholder="Selecione o cliente"
                options={clientOptions}
                {...register("clientId", { onChange: () => setValue("legalCaseId", "") })}
              />
            )}
          </Field>
          <Field label="Caso" requirement="required" error={errors.legalCaseId?.message} hint="O contrato pertence ao caso e abrange todos os processos dele.">
            {(p) => (
              <Select
                {...p}
                disabled={!values.clientId}
                placeholder={values.clientId ? "Selecione o caso" : "Selecione o cliente primeiro"}
                options={clientCases.map((c) => ({ value: c.id, label: caseLabel(c) }))}
                {...register("legalCaseId")}
              />
            )}
          </Field>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field
            label="Modelo de Honorários"
            requirement="recommended"
            hint={selectedModel ? BILLING_MOMENT_LABEL[selectedModel.billingMoment] : "Sem modelo, os valores são definidos manualmente."}
          >
            {(p) => (
              <Select
                {...p}
                placeholder="Sem modelo — definir valores manualmente"
                options={modelOptions}
                {...register("feeModelId", { onChange: (e: ChangeEvent<HTMLSelectElement>) => applyModel(e.target.value) })}
              />
            )}
          </Field>
          <div className="flex items-end gap-2 pb-[1px]">
            {selectedModel && !values.customized && (
              <Button variant="secondary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => setValue("customized", true)}>
                Personalizar para este cliente
              </Button>
            )}
            {selectedModel && values.customized && (
              <>
                <Badge tone="gold">Personalizado</Badge>
                <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => applyModel(selectedModel.id)}>
                  Restaurar valores do modelo
                </Button>
              </>
            )}
          </div>
        </div>
        {selectedModel?.description && <p className="text-[12.5px] text-muted">{selectedModel.description}</p>}
        <FeeValuesFields register={register} errors={errors} readOnly={readOnly} />
      </div>

      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
        <Field label="Data de início" requirement="required" error={errors.startDate?.message}>
          {(p) => <Input {...p} type="date" {...register("startDate")} />}
        </Field>
        <Field label="Observações" requirement="optional" className="col-span-2">
          {(p) => <Textarea {...p} rows={2} placeholder="Condições negociadas, forma de pagamento…" {...register("notes")} />}
        </Field>
      </div>

      <SchedulePreview values={formToFeeValues(values)} startDate={values.startDate ?? ""} caseValue={caseValue} />

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
