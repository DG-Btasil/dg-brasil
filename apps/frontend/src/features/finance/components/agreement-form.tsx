"use client";

import { useState } from "react";
import { PencilLine, RotateCcw } from "lucide-react";
import { todayISO } from "@/lib/clock";
import { BILLING_MOMENT_LABEL } from "@/lib/constants/status";
import { callAction, mapFieldErrors } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { createAgreementAction } from "@/server/domain/finance/actions";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { useToast } from "@/store/ui-store";
import { searchFinanceProcesses } from "../process-picker";
import { agreementCreateInput, feeTermsFromModel, type AgreementValues, type FeeTermsValues } from "../server-input";

const TERM_FIELDS: { key: keyof FeeTermsValues; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: "upfrontFee", label: "Entrada (R$)", placeholder: "0,00" },
  { key: "fixedFee", label: "Valor fixo (R$)", placeholder: "0,00" },
  { key: "installments", label: "Nº de parcelas do valor fixo", placeholder: "1", numeric: true },
  { key: "monthlyFee", label: "Mensalidade (R$)", placeholder: "0,00" },
  { key: "successFeePercent", label: "Percentual de êxito (%)", placeholder: "0" },
];

const FIELD_MAP: Record<string, string> = { legalProcessId: "legalProcessId" };

/**
 * Contrato de honorários de um PROCESSO (046; createAgreementAction, chave por
 * intenção). O modelo preenche os termos; "Personalizar" libera a edição. Sem
 * termos e com modelo, o SERVIDOR copia os termos do modelo. As obrigações
 * (parcelas) são registradas depois, na gaveta do contrato.
 *
 * Vindo de um caso (`caseProcesses`), pergunta qual processo dele; sem
 * processo pré-escolhido, busca no servidor.
 */
export function AgreementForm({
  feeModels,
  defaultProcess,
  caseProcesses,
  onCreated,
  onCancel,
}: {
  feeModels: FeeModelDTO[];
  defaultProcess?: PickerOption;
  /** Processos do caso de origem (?caso=): a escolha fica entre eles. */
  caseProcesses?: PickerOption[];
  onCreated: (legalProcessId: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const fromCase = !defaultProcess && !!caseProcesses && caseProcesses.length > 0;
  const [process, setProcess] = useState<PickerOption | null>(defaultProcess ?? (caseProcesses?.length === 1 ? caseProcesses[0] : null));
  const [values, setValues] = useState<AgreementValues>({ feeModelId: "", startDate: todayISO(), notes: "", activate: false, ...feeTermsFromModel(undefined) });
  const [customized, setCustomized] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const model = feeModels.find((m) => m.id === values.feeModelId);
  const readOnly = !!model && !customized;
  const set = <K extends keyof AgreementValues>(key: K, value: AgreementValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const pickProcess = (o: PickerOption | null) => {
    setProcess(o);
    setErrors((e) => ({ ...e, legalProcessId: "" }));
  };

  function applyModel(id: string) {
    const m = feeModels.find((x) => x.id === id);
    setValues((v) => ({ ...v, feeModelId: id, ...feeTermsFromModel(m) }));
    setCustomized(!m);
  }

  async function submit() {
    if (!process) {
      setErrors({ legalProcessId: "Selecione o processo." });
      return;
    }
    const payload = agreementCreateInput(process.id, values);
    setSaving(true);
    const result = await callAction(() => createAgreementAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSaving(false);
    if (!result.ok) {
      const fields = mapFieldErrors(result.error.fieldErrors, FIELD_MAP);
      setErrors(fields);
      if (Object.keys(fields).length === 0) failed(result, "Não foi possível criar o contrato.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: values.activate ? "Contrato criado e ativado" : "Contrato criado em rascunho", description: "Registre as obrigações na gaveta do contrato." });
    onCreated(process.id);
  }

  return (
    <form
      noValidate
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-x-5 gap-y-4">
        <Field
          label="Processo"
          requirement="required"
          error={errors.legalProcessId}
          hint={fromCase ? "Escolha o processo do caso. Cada processo tem o seu contrato de honorários." : "O contrato pertence ao processo. Um contrato ativo por processo."}
        >
          {(p) =>
            fromCase ? (
              <Select
                {...p}
                placeholder="Selecione o processo do caso"
                options={caseProcesses!.map((o) => ({ value: o.id, label: o.description ? `${o.label} — ${o.description}` : o.label }))}
                value={process?.id ?? ""}
                onChange={(e) => pickProcess(caseProcesses!.find((o) => o.id === e.target.value) ?? null)}
              />
            ) : (
              <AsyncPicker {...p} value={process} onChange={pickProcess} search={searchFinanceProcesses} placeholder="Buscar por cliente, título ou número CNJ" />
            )
          }
        </Field>
        <Field label="Modelo de honorários" requirement="recommended" hint={model ? BILLING_MOMENT_LABEL[model.billingMoment] : "Sem modelo, os valores são definidos manualmente."} error={errors.feeModelId}>
          {(p) => (
            <Select
              {...p}
              placeholder="Sem modelo — definir valores manualmente"
              options={feeModels.filter((m) => m.active).map((m) => ({ value: m.id, label: m.name }))}
              value={values.feeModelId}
              onChange={(e) => applyModel(e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="flex items-center gap-2">
        {model && !customized && (
          <Button variant="secondary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => setCustomized(true)}>
            Personalizar para este processo
          </Button>
        )}
        {model && customized && (
          <>
            <Badge tone="gold">Personalizado</Badge>
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => applyModel(model.id)}>
              Restaurar valores do modelo
            </Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
        {TERM_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} requirement="optional" hint={readOnly ? "Definido pelo modelo" : undefined} error={errors[f.key]}>
            {(p) => (
              <Input
                {...p}
                inputMode={f.numeric ? "numeric" : "decimal"}
                placeholder={f.placeholder}
                readOnly={readOnly}
                aria-readonly={readOnly || undefined}
                className={readOnly ? "bg-surface-muted text-muted" : undefined}
                value={values[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">
        <Field label="Data de início" requirement="optional" error={errors.startDate}>
          {(p) => <Input {...p} type="date" value={values.startDate} onChange={(e) => set("startDate", e.target.value)} />}
        </Field>
        <Field label="Observações" requirement="optional" className="col-span-2" error={errors.notes}>
          {(p) => <Textarea {...p} rows={2} maxLength={2000} placeholder="Condições negociadas, forma de pagamento…" value={values.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
      </div>
      <Checkbox
        label="Ativar agora"
        description="Ativo recebe lançamentos e congela os termos. Um contrato ativo por processo. Sem marcar, nasce em rascunho."
        checked={values.activate}
        onChange={(e) => set("activate", e.target.checked)}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button type="submit" loading={saving}>
          Criar contrato
        </Button>
      </div>
    </form>
  );
}
