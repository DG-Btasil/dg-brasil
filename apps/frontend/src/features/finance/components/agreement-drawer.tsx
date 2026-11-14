"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, MoreHorizontal, Plus, RotateCcw } from "lucide-react";
import { formatCNJ, formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/formatting";
import { loadAllPages } from "@/lib/actions/all-pages";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { usePermission } from "@/features/auth/hooks";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
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
import { useRefresh } from "@/lib/hooks/use-refresh";
import { FinanceRefreshDeferralProvider } from "../refresh-deferral";
import { receiptRemaining } from "../receipts";
import { useFinanceActions } from "../use-finance-actions";
import { AdjustmentDialog, ConfirmDialog, PaymentDialog, ReasonDialog, ReceiptDialog, ReversalDialog, ScheduleDialog } from "./finance-dialogs";

type Modal =
  | { kind: "payment"; payment?: PaymentDTO }
  | { kind: "schedule" }
  | { kind: "cancelPayment"; payment: PaymentDTO }
  | { kind: "receipt"; payment: PaymentDTO }
  | { kind: "adjustment"; payment: PaymentDTO }
  | { kind: "reversal"; receipt: ReceiptDTO }
  | { kind: "status"; to: "ACTIVE" | "COMPLETED" | "CANCELLED" }
  | { kind: "reopen" };

const STATUS_COPY = {
  ACTIVE: { title: "Ativar contrato", confirm: "Ativar", text: "Com o contrato ativo, os recebimentos podem ser registrados. Os valores combinados ficam congelados (só o rascunho muda)." },
  COMPLETED: {
    title: "Concluir contrato",
    confirm: "Concluir",
    text: "O sistema confere que não há parcela em aberto. Contrato concluído não recebe parcela nem lançamento novo. Se precisar estornar depois, reabra o contrato.",
  },
  CANCELLED: {
    title: "Cancelar contrato",
    confirm: "Cancelar contrato",
    text: "O sistema confere que não há parcela em aberto. Se houver valor a devolver ao cliente, registre o estorno antes de cancelar. Contrato cancelado só volta se for reaberto, com motivo.",
  },
} as const;

/** Por que estorno e ajuste não aparecem: todo lançamento exige contrato ativo (064). */
const CLOSED_COPY = {
  COMPLETED: "Este contrato está concluído. Para estornar ou ajustar um recebimento, reabra o contrato.",
  CANCELLED: "Este contrato está cancelado. Para estornar ou ajustar um recebimento, reabra o contrato.",
} as const;

/**
 * Contrato de honorários: valores combinados, parcelas (com situação derivada
 * do livro de lançamentos) e lançamentos. Toda mudança passa pelo servidor e
 * pelas guardas do banco de dados (030, 064); a gaveta recarrega depois de
 * cada resposta. Lançamento (recebimento, estorno, ajuste) só em contrato
 * ATIVO: concluído ou cancelado precisa ser reaberto, com motivo.
 */
export function AgreementDrawer({ agreement, onClose, onChanged }: { agreement: AgreementListItemDTO; onClose: () => void; onChanged?: () => void }) {
  // Gravações na gaveta não recarregam a página (ela atrasava a leitura das parcelas); ao fechar, se algo mudou, recarrega.
  const refresh = useRefresh();
  const dirty = useRef(false);
  const deferral = useMemo(
    () => ({
      markDirty: () => {
        dirty.current = true;
      },
    }),
    [],
  );
  const close = useCallback(() => {
    if (dirty.current) refresh();
    onClose();
  }, [onClose, refresh]);
  return (
    <FinanceRefreshDeferralProvider value={deferral}>
      <AgreementDrawerContent agreement={agreement} onClose={close} onChanged={onChanged} />
    </FinanceRefreshDeferralProvider>
  );
}

function AgreementDrawerContent({ agreement, onClose, onChanged }: { agreement: AgreementListItemDTO; onClose: () => void; onChanged?: () => void }) {
  const canManage = usePermission("finance.manage");
  const [payments, setPayments] = useState<ActionResult<Page<PaymentDTO>> | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ledger, setLedger] = useState<Record<string, ActionResult<Page<ReceiptDTO>>>>({});
  const [version, setVersion] = useState(0);
  // Versão das parcelas já na tela: diferente de `version` = relendo (a lista fica marcada até chegar).
  const [loaded, setLoaded] = useState(0);
  // Depois de gravar: relê as parcelas e o contrato (situação e totais vêm da lista de contratos).
  const reload = useCallback(() => {
    setVersion((v) => v + 1);
    onChanged?.();
  }, [onChanged]);
  const actions = useFinanceActions(reload);
  const reloading = loaded !== version;

  useEffect(() => {
    let alive = true;
    callAction(() => loadAllPages((page, pageSize) => listPaymentsAction({ agreementId: agreement.id, page, pageSize, sortBy: "dueDate", sortDirection: "asc" }))).then((r) => {
      if (!alive) return;
      setPayments(r);
      setLoaded(version);
    });
    return () => {
      alive = false;
    };
  }, [agreement.id, version]);

  useEffect(() => {
    if (!expanded) return;
    let alive = true;
    callAction(() => loadAllPages((page, pageSize) => listReceiptsAction({ paymentId: expanded, page, pageSize }))).then((r) => alive && setLedger((l) => ({ ...l, [expanded]: r })));
    return () => {
      alive = false;
    };
  }, [expanded, version]);

  const open = agreement.status === "DRAFT" || agreement.status === "ACTIVE";
  const active = agreement.status === "ACTIVE";
  const closed = agreement.status === "COMPLETED" || agreement.status === "CANCELLED" ? agreement.status : null;
  const terms = [
    agreement.upfrontFee ? `Entrada ${formatCurrency(agreement.upfrontFee)}` : null,
    agreement.fixedFee ? `Fixo ${formatCurrency(agreement.fixedFee)}${agreement.installments && agreement.installments > 1 ? ` em ${agreement.installments}x` : ""}` : null,
    agreement.monthlyFee ? `Mensal ${formatCurrency(agreement.monthlyFee)}` : null,
    agreement.successFeePercent ? `Êxito ${formatPercent(agreement.successFeePercent)}` : null,
  ].filter(Boolean);

  const footer = !canManage ? undefined : open ? (
    <div className="flex w-full justify-between gap-2">
      <Button variant="ghost" onClick={() => setModal({ kind: "status", to: "CANCELLED" })}>
        Cancelar contrato
      </Button>
      {agreement.status === "DRAFT" ? (
        <Button onClick={() => setModal({ kind: "status", to: "ACTIVE" })}>Ativar contrato</Button>
      ) : (
        <Button variant="secondary" onClick={() => setModal({ kind: "status", to: "COMPLETED" })}>
          Concluir contrato
        </Button>
      )}
    </div>
  ) : (
    <div className="flex w-full justify-end">
      <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setModal({ kind: "reopen" })}>
        Reabrir contrato
      </Button>
    </div>
  );

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      width={880}
      title={agreement.processTitle || agreement.caseTitle || "Contrato de honorários"}
      description={[agreement.clientName, agreement.cnjNumber ? formatCNJ(agreement.cnjNumber) : undefined].filter(Boolean).join(" · ") || undefined}
      footer={footer}
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={agreement.status} labels={AGREEMENT_DB_STATUS_LABEL} tones={AGREEMENT_DB_STATUS_TONE} />
          <Badge tone="neutral">{agreement.currency}</Badge>
          {agreement.feeModelName && <Badge tone="navy">{agreement.feeModelName}</Badge>}
        </div>
        {closed && (
          <Callout tone="info" title={closed === "COMPLETED" ? "Contrato concluído" : "Contrato cancelado"}>
            {CLOSED_COPY[closed]}
            {canManage ? " Use “Reabrir contrato”, no rodapé, e informe o motivo." : " Só o administrador pode reabrir."}
          </Callout>
        )}
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Contratado", value: formatCurrency(agreement.totals.contracted) },
            { label: "Recebido", value: formatCurrency(agreement.totals.received) },
            { label: "Em aberto", value: formatCurrency(agreement.totals.outstanding) },
            { label: "Valores combinados", value: terms.join(" · ") || "Sem valores definidos", wide: true },
            { label: "Início", value: agreement.startDate ? formatDate(agreement.startDate) : undefined },
            { label: "Observações", value: agreement.notes, wide: true },
            ...(agreement.reopenedAt ? [{ label: "Última reabertura", value: `${formatDateTime(agreement.reopenedAt)}${agreement.reopenReason ? `: ${agreement.reopenReason}` : ""}`, wide: true }] : []),
          ]}
        />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[13.5px] font-semibold text-foreground">Parcelas</h3>
            {canManage && open && (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" icon={<CalendarRange className="size-3.5" aria-hidden />} onClick={() => setModal({ kind: "schedule" })}>
                  Gerar cronograma
                </Button>
                <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setModal({ kind: "payment" })}>
                  Nova parcela
                </Button>
              </div>
            )}
          </div>
          {reloading && payments && (
            <p role="status" className="mb-2 text-[12px] text-muted">
              Atualizando as parcelas…
            </p>
          )}
          {!payments ? (
            <SkeletonRows rows={3} />
          ) : !payments.ok ? (
            <ActionErrorState error={payments} onRetry={reload} title="Não foi possível carregar as parcelas." />
          ) : payments.data.items.length === 0 ? (
            <EmptyState compact title="Nenhuma parcela neste contrato." />
          ) : (
            <div aria-busy={reloading || undefined} className={reloading ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <Table caption="Parcelas do contrato">
              <THead>
                <tr>
                  <Th>Parcela</Th>
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
                    ...(canManage && !cancelled && active && p.balance > 0 ? [{ key: "receipt", label: "Registrar recebimento", onSelect: () => setModal({ kind: "receipt", payment: p }) }] : []),
                    // Ajuste é lançamento: só em contrato ativo (064). Concluído ou cancelado: reabrir antes.
                    ...(canManage && active ? [{ key: "adjust", label: "Registrar ajuste", onSelect: () => setModal({ kind: "adjustment", payment: p }) }] : []),
                    ...(canManage && !cancelled && open ? [{ key: "edit", label: "Corrigir parcela", onSelect: () => setModal({ kind: "payment", payment: p }) }] : []),
                    ...(canManage && !cancelled && open
                      ? [
                          p.receivedAmount === 0
                            ? { key: "cancel", label: "Cancelar parcela", onSelect: () => setModal({ kind: "cancelPayment", payment: p }) }
                            : // Visível, mas explicado (QA 4.3.1, OBS-10): com recebimento, estorne antes.
                              { key: "cancel", label: "Cancelar parcela", description: "Há recebimento registrado: estorne os lançamentos antes de cancelar.", disabled: true, onSelect: () => undefined },
                        ]
                      : []),
                  ];
                  const entries = ledger[p.id];
                  // Recebimento já estornado por inteiro não oferece "Estornar" de novo.
                  const left = entries?.ok ? receiptRemaining(entries.data.items) : new Map<string, number>();
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
                          <MenuButton label="Ações da parcela" icon={<MoreHorizontal className="size-4" aria-hidden />} items={items} />
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
                                      {r.notes && <span className="text-muted"> ({r.notes})</span>}
                                    </span>
                                    <span className="flex items-center gap-3">
                                      <span className={r.amount < 0 ? "tabular text-danger" : "tabular text-foreground"}>{formatCurrency(r.amount)}</span>
                                      {r.amount > 0 && (left.get(r.id) ?? r.amount) <= 0 && <span className="text-[12px] text-muted">Estornado</span>}
                                      {canManage && active && r.amount > 0 && (left.get(r.id) ?? r.amount) > 0 && (
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
            </div>
          )}
        </section>
        <p className="text-[12px] text-subtle">Valores em reais. Recebido, saldo e situação são calculados pelo sistema a partir dos lançamentos. A divisão com parceiros também, a cada lançamento.</p>
      </div>

      {modal?.kind === "payment" && <PaymentDialog agreementId={agreement.id} payment={modal.payment} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "schedule" && <ScheduleDialog agreement={agreement} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "cancelPayment" && (
        <ReasonDialog
          title="Cancelar parcela"
          description="A parcela cancelada fica no histórico e não volta. Com recebimento, estorne antes."
          confirmLabel="Cancelar parcela"
          onConfirm={(reason) => actions.cancelPayment(modal.payment.id, reason)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "receipt" && <ReceiptDialog payment={modal.payment} onClose={() => setModal(null)} onSaved={reload} />}
      {modal?.kind === "adjustment" && <AdjustmentDialog payment={modal.payment} onClose={() => setModal(null)} onSaved={reload} />}
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
      {modal?.kind === "reopen" && (
        <ReasonDialog
          title="Reabrir contrato"
          description="O contrato volta a ficar ativo: dá para estornar ou ajustar um recebimento, receber de novo, cancelar parcela e concluir outra vez. Os valores combinados não mudam. A reabertura fica registrada com o seu nome e o motivo."
          confirmLabel="Reabrir contrato"
          variant="primary"
          onConfirm={(reason) => actions.reopenAgreement(agreement.id, reason)}
          onClose={() => setModal(null)}
        />
      )}
    </Drawer>
  );
}
