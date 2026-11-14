"use client";

import { useEffect, useState, type ReactNode } from "react";
import { todayISO } from "@/lib/clock";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { loadAllPages } from "@/lib/actions/all-pages";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { Callout } from "@/components/feedback/states";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { Page } from "@/server/core/pagination";
import { listReceiptsAction } from "@/server/domain/finance/actions";
import type { AgreementListItemDTO, PaymentDTO, ReceiptDTO } from "@/server/domain/finance/dto";
import { PAYMENT_TYPES, RECEIPT_METHODS, SCHEDULE_FREQUENCIES, SCHEDULE_MAX_INSTALLMENTS, SCHEDULE_PAYMENT_TYPES, type ScheduleFrequency } from "@/server/domain/finance/schemas";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { FREQUENCY_LABEL, previewSchedule } from "../schedule";
import { PAYMENT_TYPE_LABEL, RECEIPT_METHOD_LABEL } from "../labels";
import { moneyField, moneyInput, occurredAtInput } from "../server-input";
import { receiptRemaining } from "../receipts";
import { useFinanceActions } from "../use-finance-actions";

const TYPE_OPTIONS = PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABEL[t] }));
const METHOD_OPTIONS = RECEIPT_METHODS.map((m) => ({ value: m, label: RECEIPT_METHOD_LABEL[m] }));

/** Casca comum: título, descrição, erro geral e botão de confirmar com "carregando". */
export function FinanceDialog({
  title,
  description,
  confirmLabel,
  variant = "primary",
  saving,
  onConfirm,
  onClose,
  children,
  size,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant={variant} loading={saving} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">{children}</div>
    </Dialog>
  );
}

/** Erros de campo do servidor → mensagens por campo do diálogo. */
function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const absorb = (result: ActionResult<unknown>, map: Record<string, string> = {}, strip?: string) => {
    if (result.ok) {
      setErrors({});
      return true;
    }
    setErrors(mapFieldErrors(result.error.fieldErrors, map, strip));
    return false;
  };
  return { errors, setErrors, absorb };
}

/** Nova parcela ou correção de uma parcela (valor, vencimento, descrição). O recebido nunca se edita. */
export function PaymentDialog({ agreementId, payment, onClose, onSaved }: { agreementId: string; payment?: PaymentDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const { errors, setErrors, absorb } = useFieldErrors();
  const [amount, setAmount] = useState(moneyInput(payment?.amount));
  const [dueDate, setDueDate] = useState(payment?.dueDate ?? "");
  const [type, setType] = useState<string>(payment?.paymentType ?? "FIXED");
  const [description, setDescription] = useState(payment?.description ?? "");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    const parsed = moneyField(amount, { required: true });
    if (parsed.value === undefined) {
      setErrors({ amount: parsed.error ?? "Informe um valor maior que zero." });
      return;
    }
    const value = parsed.value;
    setSaving(true);
    if (payment) {
      const r = await actions.updatePayment(payment.id, { amount: value, dueDate: dueDate || null, description: description.trim() || null });
      setSaving(false);
      if (absorb(r, {}, "patch.")) onClose();
      return;
    }
    const input = { agreementId, amount: value, dueDate: dueDate || undefined, paymentType: type, description: description.trim() || undefined };
    const r = await actions.createPayment({ ...input, idempotencyKey: idempotency.keyFor(input) });
    setSaving(false);
    if (absorb(r)) {
      idempotency.reset();
      onClose();
    }
  }

  return (
    <FinanceDialog
      title={payment ? "Corrigir parcela" : "Nova parcela"}
      description={payment ? "O valor não pode ficar abaixo do que já foi recebido. Recebimentos são corrigidos por estorno ou ajuste." : "O que se espera receber neste contrato. A moeda é a do contrato."}
      confirmLabel={payment ? "Salvar" : "Registrar parcela"}
      saving={saving}
      onConfirm={confirm}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Valor (R$)" requirement="required" error={errors.amount}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Vencimento" requirement="optional" error={errors.dueDate}>
          {(p) => <Input {...p} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
        {!payment && (
          <Field label="Tipo" requirement="required" error={errors.paymentType}>
            {(p) => <Select {...p} options={TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />}
          </Field>
        )}
        <Field label="Descrição" requirement="optional" error={errors.description} className={payment ? "col-span-2" : undefined}>
          {(p) => <Input {...p} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
    </FinanceDialog>
  );
}

/** Motivo obrigatório (cancelar parcela, cancelar repasse, reabrir contrato). */
export function ReasonDialog({
  title,
  description,
  confirmLabel,
  variant = "danger",
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Padrão "danger" (cancelamentos). Reabrir contrato usa "primary". */
  variant?: ButtonVariant;
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <FinanceDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      variant={variant}
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        if (!reason.trim()) {
          setError("Informe o motivo.");
          return;
        }
        setSaving(true);
        const r = await onConfirm(reason.trim());
        setSaving(false);
        if (r.ok) onClose();
        else setError(mapFieldErrors(r.error.fieldErrors).reason);
      }}
    >
      <Field label="Motivo" requirement="required" error={error}>
        {(p) => <Textarea {...p} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
    </FinanceDialog>
  );
}

/** Recebimento. Campo de valor VAZIO quita o saldo (lido no servidor); texto que não é número é erro, nunca "vazio". */
export function ReceiptDialog({ payment, onClose, onSaved }: { payment: PaymentDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const { errors, setErrors, absorb } = useFieldErrors();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<string>("PIX");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <FinanceDialog
      title="Registrar recebimento"
      description={`Saldo da parcela: ${formatCurrency(payment.balance)}. Deixe o valor em branco para quitar o saldo. A divisão com o parceiro, quando houver, é calculada pelo sistema.`}
      confirmLabel="Registrar recebimento"
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = moneyField(amount);
        if (parsed.error || !date) {
          setErrors({ ...(parsed.error ? { amount: parsed.error } : {}), ...(date ? {} : { occurredAt: "Informe a data do recebimento." }) });
          return;
        }
        const input = { paymentId: payment.id, amount: parsed.value, occurredAt: occurredAtInput(date), method, notes: notes.trim() || undefined };
        setSaving(true);
        const r = await actions.registerReceipt({ ...input, idempotencyKey: idempotency.keyFor(input) });
        setSaving(false);
        if (absorb(r)) {
          idempotency.reset();
          onClose();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Valor (R$)" requirement="optional" hint="Em branco = quitar o saldo" error={errors.amount}>
          {(p) => <Input {...p} inputMode="decimal" placeholder={moneyInput(payment.balance)} value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Data do recebimento" requirement="required" error={errors.occurredAt}>
          {(p) => <Input {...p} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Forma" requirement="optional" error={errors.method}>
          {(p) => <Select {...p} options={METHOD_OPTIONS} value={method} onChange={(e) => setMethod(e.target.value)} />}
        </Field>
        <Field label="Observação" requirement="optional" error={errors.notes}>
          {(p) => <Input {...p} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </FinanceDialog>
  );
}

/**
 * Ajuste com justificativa. Para MENOS é sempre a correção de um recebimento:
 * o recebimento corrigido é obrigatório (a parte do parceiro sai da mesma
 * divisão do original; o sistema recusa sem ele). O diálogo lê os lançamentos
 * da parcela no servidor: não depende de a linha estar aberta na gaveta.
 */
export function AdjustmentDialog({ payment, onClose, onSaved }: { payment: PaymentDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const { errors, setErrors, absorb } = useFieldErrors();
  const [receipts, setReceipts] = useState<ActionResult<Page<ReceiptDTO>> | null>(null);
  const [direction, setDirection] = useState<"INCREASE" | "DECREASE">("DECREASE");
  const [amount, setAmount] = useState("");
  const [justification, setJustification] = useState("");
  const [original, setOriginal] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    callAction(() => loadAllPages((page, pageSize) => listReceiptsAction({ paymentId: payment.id, page, pageSize }))).then((r) => {
      if (!alive) return;
      setReceipts(r);
      // Um recebimento só: já vem escolhido. Nenhum: só cabe ajuste para mais. Já estornado por inteiro não conta.
      const left = r.ok ? receiptRemaining(r.data.items) : new Map<string, number>();
      const found = r.ok ? r.data.items.filter((x) => x.amount > 0 && (left.get(x.id) ?? 0) > 0) : [];
      if (found.length === 1) setOriginal(found[0].id);
      if (r.ok && found.length === 0) setDirection("INCREASE");
    });
    return () => {
      alive = false;
    };
  }, [payment.id]);

  const left = receipts?.ok ? receiptRemaining(receipts.data.items) : new Map<string, number>();
  const entries = receipts?.ok ? receipts.data.items.filter((r) => r.amount > 0 && (left.get(r.id) ?? 0) > 0) : [];
  const decrease = direction === "DECREASE";
  const noEntries = !!receipts?.ok && entries.length === 0;
  return (
    <FinanceDialog
      title="Registrar ajuste"
      description="O ajuste fica no histórico com a justificativa. Para menos, escolha o recebimento que está sendo corrigido. O contrato precisa estar ativo."
      confirmLabel="Registrar ajuste"
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = moneyField(amount, { required: true });
        const problems: Record<string, string> = {};
        if (parsed.value === undefined) problems.amount = parsed.error ?? "Informe um valor maior que zero.";
        if (!justification.trim()) problems.justification = "Informe a justificativa.";
        if (decrease && !original) problems.originalReceiptId = noEntries ? "Esta parcela não tem recebimento para corrigir." : "Escolha o recebimento que este ajuste corrige.";
        if (!date) problems.occurredAt = "Informe a data.";
        if (Object.keys(problems).length > 0) {
          setErrors(problems);
          return;
        }
        const input = { paymentId: payment.id, direction, amount: parsed.value, justification: justification.trim(), originalReceiptId: original || undefined, occurredAt: occurredAtInput(date) };
        setSaving(true);
        const r = await actions.registerAdjustment({ ...input, idempotencyKey: idempotency.keyFor(input) });
        setSaving(false);
        if (absorb(r)) {
          idempotency.reset();
          onClose();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Direção" requirement="required">
          {(p) => (
            <Select
              {...p}
              options={[
                { value: "DECREASE", label: "Para menos (correção)" },
                { value: "INCREASE", label: "Para mais" },
              ]}
              value={direction}
              onChange={(e) => setDirection(e.target.value as "INCREASE" | "DECREASE")}
            />
          )}
        </Field>
        <Field label="Valor (R$)" requirement="required" error={errors.amount || undefined}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field
          label="Recebimento corrigido"
          requirement={decrease ? "required" : "optional"}
          hint={!receipts ? "Carregando os recebimentos…" : !receipts.ok ? "Não foi possível carregar os recebimentos. Feche e tente de novo." : noEntries ? "Esta parcela ainda não tem recebimento." : undefined}
          error={errors.originalReceiptId || undefined}
        >
          {(p) => (
            <Select
              {...p}
              placeholder={decrease ? "Escolha o recebimento" : "Nenhum"}
              disabled={!receipts?.ok || noEntries}
              options={entries.map((r) => {
                const rest = left.get(r.id) ?? r.amount;
                return { value: r.id, label: `#${r.sequence} · ${formatDate(r.occurredAt)} · ${formatCurrency(r.amount)}${rest < r.amount ? ` (resta ${formatCurrency(rest)})` : ""}` };
              })}
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
            />
          )}
        </Field>
        <Field label="Data" requirement="required" error={errors.occurredAt}>
          {(p) => <Input {...p} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Justificativa" requirement="required" error={errors.justification || undefined} className="col-span-2">
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={justification} onChange={(e) => setJustification(e.target.value)} />}
        </Field>
      </div>
    </FinanceDialog>
  );
}

/** Estorno de um recebimento. Campo de valor VAZIO estorna o que resta dele; texto que não é número é erro, nunca "vazio". */
export function ReversalDialog({ receipt, onClose, onSaved }: { receipt: ReceiptDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const { errors, setErrors, absorb } = useFieldErrors();
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  return (
    <FinanceDialog
      title="Estornar lançamento"
      description={`Lançamento #${receipt.sequence} de ${formatCurrency(receipt.amount)}. O estorno é um novo lançamento; o original continua no histórico. A parte do parceiro, quando houver, é descontada pelo sistema.`}
      confirmLabel="Registrar estorno"
      variant="danger"
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        const parsed = moneyField(amount);
        if (parsed.error || !date) {
          setErrors({ ...(parsed.error ? { amount: parsed.error } : {}), ...(date ? {} : { occurredAt: "Informe a data." }) });
          return;
        }
        const input = { originalReceiptId: receipt.id, amount: parsed.value, notes: notes.trim() || undefined, occurredAt: occurredAtInput(date) };
        setSaving(true);
        const r = await actions.registerReversal({ ...input, idempotencyKey: idempotency.keyFor(input) });
        setSaving(false);
        if (absorb(r)) {
          idempotency.reset();
          onClose();
        }
      }}
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Valor (R$)" requirement="optional" hint="Em branco = o que resta do lançamento" error={errors.amount}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Data" requirement="required" error={errors.occurredAt}>
          {(p) => <Input {...p} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Observação" requirement="optional" className="col-span-2" error={errors.notes}>
          {(p) => <Textarea {...p} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
      </div>
    </FinanceDialog>
  );
}

/** Confirmação simples (mudança de situação do contrato, repasse pago). */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  variant = "primary",
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  onConfirm: () => Promise<ActionResult<unknown>>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <FinanceDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      variant={variant}
      saving={saving}
      onClose={onClose}
      onConfirm={async () => {
        setSaving(true);
        setError(undefined);
        const r = await onConfirm();
        setSaving(false);
        if (r.ok) onClose();
        // Recusado (ex.: concluir com parcela em aberto): o motivo aparece aqui, não por baixo do diálogo.
        else setError(r.error.message);
      }}
    >
      <span className="sr-only">{title}</span>
      {error && (
        <Callout tone="danger" title="O sistema não aceitou.">
          {error}
        </Callout>
      )}
    </FinanceDialog>
  );
}

const FREQUENCY_OPTIONS = SCHEDULE_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }));
const SCHEDULE_TYPE_OPTIONS = SCHEDULE_PAYMENT_TYPES.map((t) => ({ value: t, label: PAYMENT_TYPE_LABEL[t] }));

/**
 * Gerar cronograma (4.3.1): total + quantidade + 1º vencimento + periodicidade
 * → prévia (mesma regra do banco de dados) → o banco de dados cria as N
 * parcelas numa transação, com centavos exatos. Só parcelas: o ledger não muda.
 */
export function ScheduleDialog({ agreement, onClose, onSaved }: { agreement: AgreementListItemDTO; onClose: () => void; onSaved: () => void }) {
  const actions = useFinanceActions(onSaved);
  const idempotency = useIdempotencyKey();
  const { errors, setErrors, absorb } = useFieldErrors();
  const [total, setTotal] = useState(moneyInput(agreement.fixedFee ?? undefined));
  const [count, setCount] = useState(String(agreement.installments && agreement.installments > 0 ? agreement.installments : 1));
  const [firstDue, setFirstDue] = useState(agreement.startDate ?? todayISO());
  const [frequency, setFrequency] = useState<ScheduleFrequency>("MONTHLY");
  const [type, setType] = useState<string>("FIXED");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const totalField = moneyField(total, { required: true, requiredMessage: "Informe um total maior que zero." });
  const totalValue = totalField.value ?? 0;
  const n = Number(count);
  const preview = previewSchedule({ total: totalValue, count: n, firstDueDate: firstDue, frequency, description });
  const tooMany = Number.isInteger(n) && n > SCHEDULE_MAX_INSTALLMENTS;

  async function confirm() {
    if (totalField.value === undefined) return setErrors({ total: totalField.error ?? "Informe um total maior que zero." });
    if (!Number.isInteger(n) || n < 1 || tooMany) return setErrors({ installments: `De 1 a ${SCHEDULE_MAX_INSTALLMENTS} parcelas.` });
    if (!preview) return setErrors({ total: "Cada parcela precisa de pelo menos R$ 0,01." });
    const input = {
      agreementId: agreement.id,
      total: totalValue,
      installments: n,
      firstDueDate: firstDue,
      frequency,
      paymentType: type,
      description: description.trim() || undefined,
    };
    setSaving(true);
    const r = await actions.createSchedule({ ...input, idempotencyKey: idempotency.keyFor(input) });
    setSaving(false);
    if (absorb(r)) {
      idempotency.reset();
      onClose();
    }
  }

  return (
    <FinanceDialog
      title="Gerar cronograma de parcelas"
      description="Cria várias parcelas de uma vez. O sistema divide o total em centavos exatos: o resto vai para as primeiras parcelas. Todas são criadas juntas, ou nenhuma."
      confirmLabel={preview ? `Gerar ${preview.length} ${preview.length === 1 ? "parcela" : "parcelas"}` : "Gerar cronograma"}
      saving={saving}
      onConfirm={confirm}
      onClose={onClose}
    >
      <div className="grid grid-cols-3 gap-4">
        <Field label="Total (R$)" requirement="required" error={errors.total}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={total} onChange={(e) => setTotal(e.target.value)} />}
        </Field>
        <Field label="Parcelas" requirement="required" error={errors.installments ?? (tooMany ? `No máximo ${SCHEDULE_MAX_INSTALLMENTS}.` : undefined)}>
          {(p) => <Input {...p} type="number" min={1} max={SCHEDULE_MAX_INSTALLMENTS} value={count} onChange={(e) => setCount(e.target.value)} />}
        </Field>
        <Field label="1º vencimento" requirement="required" error={errors.firstDueDate}>
          {(p) => <Input {...p} type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />}
        </Field>
        <Field label="Periodicidade" requirement="required" error={errors.frequency}>
          {(p) => <Select {...p} options={FREQUENCY_OPTIONS} value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)} />}
        </Field>
        <Field label="Tipo" requirement="required" error={errors.paymentType}>
          {(p) => <Select {...p} options={SCHEDULE_TYPE_OPTIONS} value={type} onChange={(e) => setType(e.target.value)} />}
        </Field>
        <Field label="Descrição" requirement="optional" hint="Vira “Descrição 1/N”." error={errors.description}>
          {(p) => <Input {...p} placeholder="Parcela" maxLength={120} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
      </div>
      <section aria-labelledby="schedule-preview-title" className="rounded-md border border-line bg-surface-muted">
        <div className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-2.5">
          <h3 id="schedule-preview-title" className="text-[13px] font-semibold text-foreground">
            Prévia do cronograma
          </h3>
          {preview && (
            <p className="text-[12.5px] text-muted">
              Total <span className="ml-1 font-semibold tabular text-navy">{formatCurrency(preview.reduce((acc, item) => acc + Math.round(item.amount * 100), 0) / 100)}</span>
            </p>
          )}
        </div>
        {!preview ? (
          <p className="px-4 py-4 text-[12.5px] text-muted">Informe total, parcelas e o 1º vencimento para ver as parcelas.</p>
        ) : (
          <div className="max-h-[240px] overflow-y-auto">
            <Table caption="Prévia do cronograma">
              <THead>
                <tr>
                  <Th>Parcela</Th>
                  <Th>Vencimento</Th>
                  <Th className="text-right">Valor</Th>
                </tr>
              </THead>
              <TBody>
                {preview.map((item) => (
                  <Tr key={item.index}>
                    <Td className="text-[12.5px]">{item.description}</Td>
                    <Td className="tabular text-[12.5px] text-muted">{formatDate(item.dueDate)}</Td>
                    <Td className="text-right tabular text-[12.5px]">{formatCurrency(item.amount)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <p className="border-t border-line px-4 py-2 text-[12px] text-muted">Esta é a prévia. O sistema cria as parcelas com estes mesmos valores quando você confirmar.</p>
      </section>
    </FinanceDialog>
  );
}
