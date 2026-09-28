"use client";

import { useState } from "react";
import { CheckCircle2, PencilLine, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { parseCurrencyInput } from "@/lib/validation";
import type { PaymentView } from "@/types";
import { useFinanceActions } from "../hooks";
import { toMoneyInput } from "../utils";

function Summary({ payment }: { payment: PaymentView }) {
  const items = [
    { label: "Descrição", value: payment.description },
    { label: "Valor da parcela", value: formatCurrency(payment.amount) },
    { label: "Vencimento", value: formatDate(payment.dueDate) },
    { label: "Situação atual", value: PAYMENT_STATUS_LABEL[payment.status] },
    { label: "Já recebido", value: formatCurrency(payment.paidAmount) },
    { label: "Saldo", value: formatCurrency(payment.balance) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 text-[13px]">
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">{i.label}</dt>
          <dd className="mt-0.5 tabular text-foreground">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Registrar recebimento: total (padrão) ou parcial. */
function RegisterDialog({ payment, onClose }: { payment: PaymentView; onClose: () => void }) {
  const { registerPayment } = useFinanceActions();
  const [value, setValue] = useState(toMoneyInput(payment.balance));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    const amount = parseCurrencyInput(value);
    if (!amount || amount <= 0) return setError("Informe um valor maior que zero.");
    if (amount > payment.balance + 0.005) return setError(`O valor não pode passar do saldo da parcela (${formatCurrency(payment.balance)}).`);
    setSaving(true);
    await registerPayment(payment.id, `${payment.description} · ${formatCurrency(amount)}`, amount);
    setSaving(false);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title="Registrar pagamento"
      description="Confirme o recebimento. A data de hoje será registrada como data do pagamento. Para recebimento parcial, informe o valor recebido."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={<CheckCircle2 className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
            Confirmar recebimento
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Summary payment={payment} />
        <Field label="Valor recebido" requirement="required" hint="Por padrão, o saldo total da parcela." error={error}>
          {(a) => (
            <Input
              {...a}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(undefined);
              }}
              inputMode="decimal"
              className="tabular"
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Ajustes de uma parcela: corrigir o valor recebido, estornar ou alterar o vencimento. */
function AdjustDialog({ payment, onClose }: { payment: PaymentView; onClose: () => void }) {
  const { updatePaymentAmount, reversePayment, updatePaymentDueDate } = useFinanceActions();
  const [paid, setPaid] = useState(toMoneyInput(payment.paidAmount));
  const [dueDate, setDueDate] = useState(payment.dueDate);
  const [errors, setErrors] = useState<{ paid?: string; dueDate?: string }>({});
  const [saving, setSaving] = useState<"save" | "reverse" | null>(null);

  async function save() {
    const amount = paid.trim() ? parseCurrencyInput(paid) : 0;
    const next: typeof errors = {};
    if (amount === undefined || amount < 0) next.paid = "Informe um valor válido.";
    else if (amount > payment.amount + 0.005) next.paid = `O valor recebido não pode passar do valor da parcela (${formatCurrency(payment.amount)}).`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) next.dueDate = "Informe uma data válida.";
    setErrors(next);
    if (next.paid || next.dueDate || amount === undefined) return;
    setSaving("save");
    if (Math.abs(amount - payment.paidAmount) > 0.005) await updatePaymentAmount(payment.id, amount);
    if (dueDate !== payment.dueDate) await updatePaymentDueDate(payment.id, dueDate);
    setSaving(null);
    onClose();
  }

  async function reverse() {
    setSaving("reverse");
    await reversePayment(payment.id);
    setSaving(null);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Ajustar parcela"
      description="Correções ficam registradas na auditoria com a situação anterior. O status é recalculado automaticamente."
      footer={
        <>
          {payment.paidAmount > 0 && (
            <Button variant="danger" className="mr-auto" icon={<Undo2 className="size-4" aria-hidden />} loading={saving === "reverse"} onClick={reverse}>
              Estornar recebimentos
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving === "save"} onClick={save}>
            Salvar ajustes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Summary payment={payment} />
        <div className="grid grid-cols-2 gap-4">
          <Field label="Total recebido" requirement="required" hint="Zero para nenhum recebimento." error={errors.paid}>
            {(a) => <Input {...a} value={paid} onChange={(e) => setPaid(e.target.value)} inputMode="decimal" className="tabular" />}
          </Field>
          <Field label="Vencimento" requirement="required" error={errors.dueDate}>
            {(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

/** Cronograma de pagamentos com registro de recebimento e ajustes. Status sempre derivado. */
export function PaymentsTable({ payments, caption = "Cronograma de pagamentos" }: { payments: PaymentView[]; caption?: string }) {
  const [dialog, setDialog] = useState<{ kind: "register" | "adjust"; id: string } | null>(null);

  if (payments.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhum pagamento programado."
        description="Contratos apenas com honorários de êxito não geram parcelas até o resultado."
      />
    );
  }

  // Busca a parcela na lista atual: o diálogo sempre mostra o estado mais recente.
  const active = dialog ? payments.find((p) => p.id === dialog.id) : undefined;

  return (
    <>
      <Table caption={caption}>
        <THead>
          <tr>
            <Th>Descrição</Th>
            <Th>Vencimento</Th>
            <Th className="text-right">Valor</Th>
            <Th>Status</Th>
            <Th className="text-right">
              <span className="sr-only">Ações</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {payments.map((p) => (
            <Tr key={p.id}>
              <Td className="text-foreground">{p.description}</Td>
              <Td className="tabular text-muted">
                {formatDate(p.dueDate)}
                {p.paidAt && p.paidAmount > 0 && <span className="block text-[11.5px] text-subtle">Recebido em {formatDate(p.paidAt)}</span>}
              </Td>
              <Td className="text-right tabular">
                {formatCurrency(p.amount)}
                {p.status !== "PAID" && p.paidAmount > 0 && <span className="block text-[11.5px] text-muted">Saldo {formatCurrency(p.balance)}</span>}
              </Td>
              <Td>
                <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} tones={PAYMENT_STATUS_TONE} />
              </Td>
              <Td className="whitespace-nowrap text-right">
                <div className="inline-flex items-center gap-1">
                  {p.status !== "PAID" && (
                    <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "register", id: p.id })} aria-label={`Registrar pagamento: ${p.description}, saldo ${formatCurrency(p.balance)}`}>
                      Registrar pagamento
                    </Button>
                  )}
                  <IconButton size="sm" label={`Ajustar parcela: ${p.description}`} onClick={() => setDialog({ kind: "adjust", id: p.id })}>
                    <PencilLine className="size-3.5" aria-hidden />
                  </IconButton>
                </div>
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {active && dialog?.kind === "register" && <RegisterDialog key={active.id} payment={active} onClose={() => setDialog(null)} />}
      {active && dialog?.kind === "adjust" && <AdjustDialog key={active.id} payment={active} onClose={() => setDialog(null)} />}
    </>
  );
}
