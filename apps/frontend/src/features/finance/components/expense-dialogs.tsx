"use client";

import { useState } from "react";
import { todayISO } from "@/lib/clock";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { mapFieldErrors } from "@/lib/actions/result";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { ExpenseCategory, ExpenseDTO } from "@/server/domain/finance/dto";
import { EXPENSE_CATEGORIES } from "@/server/domain/finance/schemas";
import { EXPENSE_CATEGORY_LABEL } from "../labels";
import { searchFinanceProcesses } from "../process-picker";
import { expenseCreateInput, expenseMissingFields, expensePatch, expenseToValues, type ExpenseValues } from "../server-input";
import { useFinanceActions } from "../use-finance-actions";
import { FinanceDialog } from "./finance-dialogs";

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }));

/**
 * Nova despesa ou correção de uma despesa do processo. Sem processo no
 * contexto (lista geral do Financeiro), pede o processo (busca no servidor).
 * O caso o servidor lê do processo. Sem data de pagamento = a pagar.
 */
export function ExpenseDialog({
  processId,
  expense,
  onClose,
  onSaved,
}: {
  /** Processo fixo (aba Financeiro do processo). Ausente + sem `expense` = escolher. */
  processId?: string;
  expense?: ExpenseDTO;
  onClose: () => void;
  onSaved: () => void;
}) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const [values, setValues] = useState<ExpenseValues>(() => expenseToValues(expense, todayISO()));
  const [process, setProcess] = useState<PickerOption | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ExpenseValues>(key: K, value: ExpenseValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const fixedProcess = expense?.legalProcessId ?? processId;
  const needsProcess = !fixedProcess;

  async function confirm() {
    const missing = expenseMissingFields(values) as Record<string, string>;
    if (needsProcess && !process) missing.processId = "Selecione o processo.";
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }
    setSaving(true);
    // Despesa nova vai com a chave do envio: clique duplo ou reenvio não lança duas.
    const input = expense ? undefined : expenseCreateInput(fixedProcess ?? process!.id, values);
    const r = expense ? await actions.updateExpense(expense.id, expensePatch(values)) : await actions.createExpense({ ...input, idempotencyKey: idempotency.keyFor(input) });
    setSaving(false);
    if (r.ok) {
      idempotency.reset();
      onClose();
    } else setErrors(mapFieldErrors(r.error.fieldErrors, {}, expense ? "patch." : undefined));
  }

  return (
    <FinanceDialog
      size="lg"
      title={expense ? "Corrigir despesa" : "Nova despesa"}
      description={
        expense
          ? "Corrija os dados ou a data do pagamento. Para desfazer um lançamento, cancele a despesa (ela fica no histórico)."
          : "Custas, advogado contratado, perícia, audiência, deslocamento… A despesa fica ligada ao processo e entra no resultado dele."
      }
      confirmLabel={expense ? "Salvar" : "Lançar despesa"}
      saving={saving}
      onConfirm={confirm}
      onClose={onClose}
    >
      {needsProcess && (
        <Field label="Processo" requirement="required" error={errors.processId}>
          {(p) => (
            <AsyncPicker
              {...p}
              value={process}
              onChange={(o) => {
                setProcess(o);
                setErrors((e) => ({ ...e, processId: "" }));
              }}
              search={searchFinanceProcesses}
              placeholder="Buscar por cliente, título ou número CNJ"
            />
          )}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Categoria" requirement="required" error={errors.category}>
          {(p) => <Select {...p} placeholder="Selecione" options={CATEGORY_OPTIONS} value={values.category} onChange={(e) => set("category", e.target.value as ExpenseCategory | "")} />}
        </Field>
        <Field label="Valor (R$)" requirement="required" error={errors.amount}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={values.amount} onChange={(e) => set("amount", e.target.value)} />}
        </Field>
        <Field label="Descrição" requirement="required" className="col-span-2" error={errors.description}>
          {(p) => <Input {...p} maxLength={500} placeholder="Ex.: Custas iniciais, perito judicial, diligência…" value={values.description} onChange={(e) => set("description", e.target.value)} />}
        </Field>
        <Field label="Data da despesa" requirement="required" error={errors.incurredOn}>
          {(p) => <Input {...p} type="date" value={values.incurredOn} onChange={(e) => set("incurredOn", e.target.value)} />}
        </Field>
        <Field label="Fornecedor / prestador" requirement="optional" error={errors.supplier}>
          {(p) => <Input {...p} maxLength={200} placeholder="Ex.: Tribunal, perito, advogado correspondente" value={values.supplier} onChange={(e) => set("supplier", e.target.value)} />}
        </Field>
        <div className="space-y-2 self-end">
          <Checkbox label="Já foi paga" checked={values.paid} onChange={(e) => set("paid", e.target.checked)} />
        </div>
        {values.paid ? (
          <Field label="Data do pagamento" requirement="required" error={errors.paidOn}>
            {(p) => <Input {...p} type="date" max={todayISO()} value={values.paidOn} onChange={(e) => set("paidOn", e.target.value)} />}
          </Field>
        ) : (
          <p className="self-end pb-2 text-[12px] text-muted">Sem data de pagamento, a despesa fica “a pagar”.</p>
        )}
        <Checkbox
          className="col-span-2"
          label="Reembolsável pelo cliente"
          description="Ex.: custas adiantadas pelo escritório que o cliente devolve."
          checked={values.reimbursable}
          onChange={(e) => set("reimbursable", e.target.checked)}
        />
        <Field label="Observações" requirement="optional" className="col-span-2" error={errors.notes}>
          {(p) => <Textarea {...p} rows={2} maxLength={2000} value={values.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
      </div>
    </FinanceDialog>
  );
}

/** Marca a despesa a pagar como paga (data do pagamento; nunca no futuro). */
export function MarkExpensePaidDialog({ expense, onClose, onSaved }: { expense: ExpenseDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <FinanceDialog
      title="Marcar como paga"
      description={`${EXPENSE_CATEGORY_LABEL[expense.category]} · ${expense.description} · ${formatCurrency(expense.amount)} (lançada em ${formatDate(expense.incurredOn)}).`}
      confirmLabel="Marcar como paga"
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        if (!date) {
          setError("Informe a data do pagamento.");
          return;
        }
        setSaving(true);
        const r = await actions.markExpensePaid(expense.id, date);
        setSaving(false);
        if (r.ok) onClose();
        else setError(mapFieldErrors(r.error.fieldErrors, {}, "patch.").paidOn);
      }}
    >
      <Field label="Data do pagamento" requirement="required" error={error}>
        {(p) => <Input {...p} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
    </FinanceDialog>
  );
}
