"use client";

import { useCallback, useState } from "react";
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
import { listCasesAction } from "@/server/domain/cases/actions";
import { createAgreementAction } from "@/server/domain/finance/actions";
import type { FeeModelDTO } from "@/server/domain/finance/dto";
import { useToast } from "@/store/ui-store";
import { agreementCreateInput, feeTermsFromModel, type AgreementValues, type FeeTermsValues } from "../server-input";

const TERM_FIELDS: { key: keyof FeeTermsValues; label: string; placeholder: string; numeric?: boolean }[] = [
  { key: "upfrontFee", label: "Entrada (R$)", placeholder: "0,00" },
  { key: "fixedFee", label: "Valor fixo (R$)", placeholder: "0,00" },
  { key: "installments", label: "Nº de parcelas do valor fixo", placeholder: "1", numeric: true },
  { key: "monthlyFee", label: "Mensalidade (R$)", placeholder: "0,00" },
  { key: "successFeePercent", label: "Percentual de êxito (%)", placeholder: "0" },
];

const FIELD_MAP: Record<string, string> = { legalCaseId: "legalCaseId" };

/**
 * Contrato de honorários de um CASO (createAgreementAction, chave por
 * intenção). O modelo preenche os termos; "Personalizar" libera a edição. Sem
 * termos e com modelo, o SERVIDOR copia os termos do modelo. As obrigações
 * (parcelas) são registradas depois, na gaveta do contrato.
 */
export function AgreementForm({
  feeModels,
  defaultCase,
  onCreated,
  onCancel,
}: {
  feeModels: FeeModelDTO[];
  defaultCase?: PickerOption;
  onCreated: (legalCaseId: string) => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [legalCase, setLegalCase] = useState<PickerOption | null>(defaultCase ?? null);
  const [values, setValues] = useState<AgreementValues>({ feeModelId: "", startDate: todayISO(), notes: "", activate: false, ...feeTermsFromModel(undefined) });
  const [customized, setCustomized] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const model = feeModels.find((m) => m.id === values.feeModelId);
  const readOnly = !!model && !customized;
  const set = <K extends keyof AgreementValues>(key: K, value: AgreementValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const searchCases = useCallback(async (q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> => {
    const r = await callAction(() => listCasesAction({ q: q.trim() || undefined, pageSize: 10, sortBy: "updatedAt", sortDirection: "desc" }));
    if (!r.ok) return { ok: false, message: r.error.message };
    return { ok: true, options: r.data.items.map((c) => ({ id: c.id, label: c.title, description: c.clientName })) };
  }, []);

  function applyModel(id: string) {
    const m = feeModels.find((x) => x.id === id);
    setValues((v) => ({ ...v, feeModelId: id, ...feeTermsFromModel(m) }));
    setCustomized(!m);
  }

  async function submit() {
    if (!legalCase) {
      setErrors({ legalCaseId: "Selecione o caso." });
      return;
    }
    const payload = agreementCreateInput(legalCase.id, values);
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
    onCreated(legalCase.id);
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
        <Field label="Caso" requirement="required" error={errors.legalCaseId} hint="O contrato pertence ao caso e abrange todos os processos dele.">
          {(p) => (
            <AsyncPicker
              {...p}
              value={legalCase}
              onChange={(o) => {
                setLegalCase(o);
                setErrors((e) => ({ ...e, legalCaseId: "" }));
              }}
              search={searchCases}
              placeholder="Buscar caso pelo título"
            />
          )}
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
            Personalizar para este caso
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
        description="Ativo recebe lançamentos e congela os termos. Um contrato ativo por caso. Sem marcar, nasce em rascunho."
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
