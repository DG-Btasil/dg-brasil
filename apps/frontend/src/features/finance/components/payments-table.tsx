"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/states";
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import type { Payment } from "@/types";
import { useFinanceActions } from "../hooks";

/** Cronograma de pagamentos com a ação "Registrar pagamento" nos itens em aberto. */
export function PaymentsTable({ payments, caption = "Cronograma de pagamentos" }: { payments: Payment[]; caption?: string }) {
  const [confirming, setConfirming] = useState<Payment | null>(null);
  const [saving, setSaving] = useState(false);
  const { registerPayment } = useFinanceActions();

  if (payments.length === 0) {
    return (
      <EmptyState
        compact
        title="Nenhum pagamento programado."
        description="Contratos apenas com honorários de êxito não geram parcelas até o resultado."
      />
    );
  }

  async function confirm() {
    if (!confirming) return;
    setSaving(true);
    await registerPayment(confirming.id, `${confirming.description} · ${formatCurrency(confirming.amount)}`);
    setSaving(false);
    setConfirming(null);
  }

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
                {p.paidAt && <span className="block text-[11.5px] text-subtle">Pago em {formatDate(p.paidAt)}</span>}
              </Td>
              <Td className="text-right tabular">{formatCurrency(p.amount)}</Td>
              <Td>
                <StatusBadge status={p.status} labels={PAYMENT_STATUS_LABEL} tones={PAYMENT_STATUS_TONE} />
              </Td>
              <Td className="text-right">
                {p.status !== "PAID" && (
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(p)} aria-label={`Registrar pagamento: ${p.description}, ${formatCurrency(p.amount)}`}>
                    Registrar pagamento
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      <Dialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        size="sm"
        title="Registrar pagamento"
        description="Confirme o recebimento. A data de hoje será registrada como data do pagamento."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancelar
            </Button>
            <Button icon={<CheckCircle2 className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
              Confirmar recebimento
            </Button>
          </>
        }
      >
        {confirming && (
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">Descrição</dt>
              <dd className="mt-0.5 text-foreground">{confirming.description}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">Valor</dt>
              <dd className="mt-0.5 tabular text-foreground">{formatCurrency(confirming.amount)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">Vencimento</dt>
              <dd className="mt-0.5 tabular text-foreground">{formatDate(confirming.dueDate)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] uppercase tracking-[0.06em] text-subtle">Situação atual</dt>
              <dd className="mt-0.5 text-foreground">{PAYMENT_STATUS_LABEL[confirming.status]}</dd>
            </div>
          </dl>
        )}
      </Dialog>
    </>
  );
}
