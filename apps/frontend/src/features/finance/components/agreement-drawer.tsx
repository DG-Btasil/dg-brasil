"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { usePermission } from "@/features/auth/hooks";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { MenuButton } from "@/components/ui/menu";
import { DefinitionGrid } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import { listPaymentsAction, listReceiptsAction } from "@/server/domain/finance/actions";
import type { AgreementListItemDTO, PaymentDTO, ReceiptDTO } from "@/server/domain/finance/dto";
import { AGREEMENT_DB_STATUS_LABEL, AGREEMENT_DB_STATUS_TONE, PAYMENT_DB_STATUS_LABEL, PAYMENT_DB_STATUS_TONE, PAYMENT_TYPE_LABEL, RECEIPT_KIND_LABEL, RECEIPT_METHOD_LABEL } from "../labels";
import { useFinanceActions } from "../use-finance-actions";
import { AdjustmentDialog, ConfirmDialog, PaymentDialog, ReasonDialog, ReceiptDialog, ReversalDialog } from "./finance-dialogs";

type Modal =
  | { kind: "payment"; payment?: PaymentDTO }
  | { kind: "cancelPayment"; payment: PaymentDTO }
  | { kind: "receipt"; payment: PaymentDTO }
  | { kind: "adjustment"; payment: PaymentDTO }
  | { kind: "reversal"; receipt: ReceiptDTO }
  | { kind: "status"; to: "ACTIVE" | "COMPLETED" | "CANCELLED" };

const STATUS_COPY = {
  ACTIVE: { title: "Ativar acordo", confirm: "Ativar", text: "Com o acordo ativo, recebimentos podem ser registrados. Os termos ficam congelados (só o rascunho muda)." },
  COMPLETED: { title: "Concluir acordo", confirm: "Concluir", text: "O banco confere que não há obrigação em aberto. Acordo concluído é histórico: não muda nem recebe obrigação nova." },
  CANCELLED: { title: "Cancelar acordo", confirm: "Cancelar acordo", text: "O banco confere que não há obrigação em aberto. Acordo cancelado é histórico e não volta." },
} as const;

/**
 * Acordo de honorários: termos, obrigações (com situação derivada do ledger)
 * e lançamentos. Toda mudança passa pelo servidor e pelas guardas do banco
 * (030); a gaveta recarrega depois de cada resposta.
 */
export function AgreementDrawer({ agreement, onClose }: { agreement: AgreementListItemDTO; onClose: () => void }) {
  const canManage = usePermission("finance.manage");
  const [payments, setPayments] = useState<ActionResult<Page<PaymentDTO>> | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Record<string, ActionResult<Page<ReceiptDTO>>>>({});
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const actions = useFinanceActions(reload);

  useEffect(() => {
    let alive = true;
    callAction(() => listPaymentsAction({ agreementId: agreement.id, pageSize: 100, sortBy: "dueDate", sortDirection: "asc" })).then((r) => alive && setPayments(r));
    return () => {
      alive = false;
    };
  }, [agreement.id, version]);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    callAction(() => listReceiptsAction({ paymentId: expanded, pageSize: 100 })).then((r) => alive && setLedger((l) => ({ ...l, [expanded]: r })));
    return () => {
      alive = false;
    };
  }, [expanded, version]);

  const open = agreement.status === "DRAFT" || agreement.status === "ACTIVE";
  const ledgerItems = (paymentId: string): ReceiptDTO[] => {
    const entries = ledger[paymentId];
    return entries?.ok ? entries.data.items : [];
  };
  const terms = [
    agreement.upfrontFee ? `Entrada ${formatCurrency(agreement.upfrontFee)}` : null,
    agreement.fixedFee ? `Fixo ${formatCurrency(agreement.fixedFee)}${agreement.installments && agreement.installments > 1 ? ` em ${agreement.installments}x` : ""}` : null,
    agreement.monthlyFee ? `Mensal ${formatCurrency(agreement.monthlyFee)}` : null,
    agreement.successFeePercent ? `Êxito ${formatPercent(agreement.successFeePercent)}` : null,
  ].filter(Boolean);

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width={880}
      title={agreement.caseTitle || "Contrato de honorários"}
      description={agreement.clientName}
      footer={
        canManage && open ? (
          <div className="flex w-full justify-between gap-2">
            <Button variant="ghost" onClick={() => setModal({ kind: "status", to: "CANCELLED" })}>
              Cancelar acordo
            </Button>
            {agreement.status === "DRAFT" ? (
              <Button onClick={() => setModal({ kind: "status", to: "ACTIVE" })}>Ativar acordo</Button>
            ) : (
              <Button variant="secondary" onClick={() => setModal({ kind: "status", to: "COMPLETED" })}>
                Concluir acordo
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={agreement.status} labels={AGREEMENT_DB_STATUS_LABEL} tones={AGREEMENT_DB_STATUS_TONE} />
          <Badge tone="neutral">{agreement.currency}</Badge>
          {agreement.feeModelName && <Badge tone="navy">{agreement.feeModelName}</Badge>}
        </div>
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Contratado", value: formatCurrency(agreement.totals.contracted) },
            { label: "Recebido", value: formatCurrency(agreement.totals.received) },
            { label: "Em aberto", value: formatCurrency(agreement.totals.outstanding) },
            { label: "Termos", value: terms.join(" · ") || "Sem valores definidos", wide: true },
            { label: "Início", value: agreement.startDate ? formatDate(agreement.startDate) : undefined },
            { label: "Observações", value: agreement.notes, wide: true },
          ]}
        />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold text-foreground">Obrigações</h3>
            {canManage && open && (
              <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setModal({ kind: "payment" })}>
                Nova obrigação
              </Button>
            )}
          </div>
          {!payments ? (
            <SkeletonRows rows={3} />
          ) : !payments.ok ? (
            <ActionErrorState error={payments} onRetry={reload} title="Não foi possível carregar as obrigações." />
          ) : payments.data.items.length === 0 ? (
            <EmptyState compact title="Nenhuma obrigação neste acordo." />
          ) : (
            <Table caption="Obrigações do acordo">
              <THead>
                <tr>
                  <Th>Obrigação</Th>
                  <Th>Vencimento</Th>
                  <Th className="text-right">Valor</Th>
                  <Th className="text-right">Recebido</Th>
                  <Th>Situação</Th>
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {payments.data.items.map((p) => {
                  const cancelled = p.status === "CANCELLED";
                  const items = [
                    { key: "ledger", label: expanded === p.id ? "Ocultar lançamentos" : "Ver lançamentos", onSelect: () => setExpanded(expanded === p.id ? null : p.id) },
                    ...(canManage && !cancelled && agreement.status === "ACTIVE" && p.balance > 0
                      ? [{ key: "receipt", label: "Registrar recebimento", onSelect: () => setModal({ kind: "receipt", payment: p }) }]
                      : []),
                    ...(canManage ? [{ key: "adjust", label: "Registrar ajuste", onSelect: () => setModal({ kind: "adjustment", payment: p }) }] : []),
                    ...(canManage && !cancelled && open ? [{ key: "edit", label: "Corrigir obrigação", onSelect: () => setModal({ kind: "payment", payment: p }) }] : []),
                    ...(canManage && !cancelled && open && p.receivedAmount === 0
                      ? [{ key: "cancel", label: "Cancelar obrigação", onSelect: () => setModal({ kind: "cancelPayment", payment: p }) }]
                      : []),
                  ];
                  const entries = ledger[p.id];
                  return (
                    <Fragment key={p.id}>
                      <Tr className={cancelled ? "text-muted" : undefined}>
                        <Td>
                          <span className="block text-foreground">{PAYMENT_TYPE_LABEL[p.paymentType]}</span>
                          {p.description && <span className="block text-[12px] text-muted">{p.description}</span>}
                        </Td>
                        <Td className="tabular text-muted">{p.dueDate ? formatDate(p.dueDate) : "—"}</Td>
                        <Td className="text-right tabular">{formatCurrency(p.amount)}</Td>
                        <Td className="text-right tabular">{formatCurrency(p.receivedAmount)}</Td>
                        <Td>
                          <StatusBadge status={p.status} labels={PAYMENT_DB_STATUS_LABEL} tones={PAYMENT_DB_STATUS_TONE} />
                        </Td>
                        <Td className="text-right">
                          <MenuButton label="Ações da obrigação" icon={<MoreHorizontal className="size-4" aria-hidden />} items={items} />
                        </Td>
                      </Tr>
                      {expanded === p.id && (
                        <tr>
                          <td colSpan={6} className="bg-surface-muted px-5 py-3">
                            {!entries ? (
                              <SkeletonRows rows={2} />
                            ) : !entries.ok ? (
                              <ActionErrorState error={entries} title="Não foi possível carregar os lançamentos." />
                            ) : entries.data.items.length === 0 ? (
                              <p className="text-[12.5px] text-muted">Nenhum lançamento. Lançamentos não se editam: corrija com estorno ou ajuste.</p>
                            ) : (
                              <ul className="space-y-1.5">
                                {entries.data.items.map((r) => (
                                  <li key={r.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                                    <span>
                                      <span className="tabular text-subtle">#{r.sequence}</span> {RECEIPT_KIND_LABEL[r.kind]}
                                      {r.method && ` · ${RECEIPT_METHOD_LABEL[r.method as keyof typeof RECEIPT_METHOD_LABEL] ?? r.method}`} · {formatDateTime(r.occurredAt)}
                                      {r.notes && <span className="text-muted"> — {r.notes}</span>}
                                    </span>
                                    <span className="flex items-center gap-3">
                                      <span className={r.amount < 0 ? "tabular text-danger" : "tabular text-foreground"}>{formatCurrency(r.amount)}</span>
                                      {canManage && r.amount > 0 && (
                                        <Button size="sm" variant="ghost" onClick={() => setModal({ kind: "reversal", receipt: r })}>
                                          Estornar
                                        </Button>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>
          )}
        </section>
        <p className="text-[12px] text-subtle">Valores em reais. Recebido, saldo e situação vêm do ledger do banco; a divisão com parceiros é gerada pelo banco a cada lançamento.</p>
      </div>

      {modal?.kind === "payment" && <PaymentDialog agreementId={agreement.id} payment={modal.payment} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "cancelPayment" && (
        <ReasonDialog
          title="Cancelar obrigação"
          description="A obrigação cancelada fica no histórico e não volta. Com recebimento, estorne antes."
          confirmLabel="Cancelar obrigação"
          onConfirm={(reason) => actions.cancelPayment(modal.payment.id, reason)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "receipt" && <ReceiptDialog payment={modal.payment} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "adjustment" && (
        <AdjustmentDialog payment={modal.payment} receipts={ledgerItems(modal.payment.id)} onClose={() => setModal(null)} onSaved={reload} />
      )}
      {modal?.kind === "reversal" && <ReversalDialog receipt={modal.receipt} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "status" && (
        <ConfirmDialog
          title={STATUS_COPY[modal.to].title}
          description={STATUS_COPY[modal.to].text}
          confirmLabel={STATUS_COPY[modal.to].confirm}
          variant={modal.to === "CANCELLED" ? "danger" : "primary"}
          onConfirm={async () => {
            const r = await actions.changeStatus(agreement.id, modal.to);
            if (r.ok) onClose();
            return r;
          }}
          onClose={() => setModal(null)}
        />
      )}
    </Drawer>
  );
}
