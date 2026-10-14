"use client";

import Link from "next/link";
import { useState } from "react";
import { Banknote, MoreHorizontal, Plus } from "lucide-react";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Stat } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/form";
import { MenuButton } from "@/components/ui/menu";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import type { PartnerAgreementShareDTO, PartnerFinanceDTO, TransferListItemDTO } from "@/server/domain/finance/dto";
import { TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE } from "../labels";
import { parseMoneyField } from "../server-input";
import { useFinanceActions } from "../use-finance-actions";
import { ReasonDialog } from "./finance-dialogs";

/**
 * Participação de UM parceiro: totais (acumulado, em repasse, repassado,
 * disponível) e participação por caso — TODOS derivados no banco (view
 * partner_allocation_balances), sem conta no navegador — e os repasses.
 * Portal (PARTNER_ADMIN): só leitura, só o próprio escritório. ADMIN: também
 * registra repasse (o banco escolhe as divisões) e marca pago/cancela.
 */
export function PartnerShareView({
  summary,
  shares,
  transfers,
  manage,
}: {
  summary: ActionResult<PartnerFinanceDTO>;
  shares: ActionResult<Page<PartnerAgreementShareDTO>>;
  transfers: ActionResult<Page<TransferListItemDTO>>;
  /** ADMIN: parceiro alvo dos repasses. Ausente = portal (só leitura). */
  manage?: { partnerOrganizationId: string };
}) {
  const actions = useFinanceActions();
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const caseHref = (id: string) => (manage ? `/casos/${id}?aba=financeiro` : `/casos/${id}`);

  return (
    <div className="space-y-5">
      {!summary.ok ? (
        <ActionErrorState error={summary} title="Não foi possível carregar a participação." />
      ) : (
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Participação acumulada" value={formatCurrency(summary.data.totals.accruedAmount)} icon={Banknote} hint={`${summary.data.activeAgreementCount} de ${summary.data.agreementCount} parcerias ativas`} />
          <Stat label="Repassado" value={formatCurrency(summary.data.totals.paidOutAmount)} tone="success" />
          <Stat label="Em repasse" value={formatCurrency(summary.data.totals.pendingTransferAmount)} hint="Registrado, ainda não pago" />
          <Stat label="Disponível" value={formatCurrency(summary.data.totals.availableAmount)} tone={summary.data.totals.availableAmount > 0 ? "gold" : "neutral"} hint="Ainda sem repasse" />
        </div>
      )}

      <Panel>
        <PanelHeader title="Participação por caso" description="Percentual congelado no aceite do caso. Mudanças posteriores na divisão padrão não alteram casos já aceitos." />
        {!shares.ok ? (
          <ActionErrorState error={shares} title="Não foi possível carregar a participação por caso." />
        ) : shares.data.items.length === 0 ? (
          <EmptyState compact title="Nenhum caso com participação registrada." />
        ) : (
          <Table caption="Participação por caso">
            <THead>
              <tr>
                <Th>Caso</Th>
                <Th className="text-right">Participação</Th>
                <Th className="text-right">Acumulado</Th>
                <Th className="text-right">Repassado</Th>
                <Th className="text-right">Disponível</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {shares.data.items.map((s) => (
                <Tr key={s.agreementId}>
                  <Td>
                    <Link href={caseHref(s.legalCaseId)} className="font-medium text-navy hover:underline underline-offset-2">
                      {s.caseTitle ?? "Caso"}
                    </Link>
                    <span className="block text-[12px] text-muted">desde {formatDate(s.effectiveAt)}</span>
                  </Td>
                  <Td className="text-right tabular">{formatPercent(s.partnerPercentage)}</Td>
                  <Td className="text-right tabular">{formatCurrency(s.accruedAmount)}</Td>
                  <Td className="text-right tabular">{formatCurrency(s.paidOutAmount)}</Td>
                  <Td className="text-right tabular font-medium">{formatCurrency(s.availableAmount)}</Td>
                  <Td>{s.status === "ACTIVE" ? <Badge tone="success">Ativa</Badge> : <Badge tone="neutral">Encerrada</Badge>}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader
          title="Repasses"
          description={manage ? "Registro interno: nenhuma transferência é feita pelo sistema. O banco escolhe as divisões com saldo, das mais antigas." : "Registros informados pela Bárbara Cardoso Advocacia."}
          actions={
            manage ? (
              <Button size="sm" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => setCreating(true)}>
                Registrar repasse
              </Button>
            ) : undefined
          }
        />
        {!transfers.ok ? (
          <ActionErrorState error={transfers} title="Não foi possível carregar os repasses." />
        ) : transfers.data.items.length === 0 ? (
          <EmptyState compact title="Nenhum repasse registrado." />
        ) : (
          <Table caption="Repasses">
            <THead>
              <tr>
                <Th>Registrado em</Th>
                <Th>Referência</Th>
                <Th className="text-right">Valor</Th>
                <Th>Situação</Th>
                {manage && (
                  <Th>
                    <span className="sr-only">Ações</span>
                  </Th>
                )}
              </tr>
            </THead>
            <TBody>
              {transfers.data.items.map((t) => (
                <Tr key={t.id}>
                  <Td className="tabular text-muted">
                    {formatDate(t.createdAt)}
                    {t.paidAt && <span className="block text-[12px]">pago em {formatDate(t.paidAt)}</span>}
                  </Td>
                  <Td className="text-[12.5px]">{t.reference ?? "—"}</Td>
                  <Td className="text-right tabular">{formatCurrency(t.amount)}</Td>
                  <Td>
                    <StatusBadge status={t.status} labels={TRANSFER_STATUS_LABEL} tones={TRANSFER_STATUS_TONE} />
                  </Td>
                  {manage && (
                    <Td className="text-right">
                      {t.status !== "CANCELLED" && (
                        <MenuButton
                          label="Ações do repasse"
                          icon={<MoreHorizontal className="size-4" aria-hidden />}
                          items={[
                            ...(t.status === "PENDING" ? [{ key: "paid", label: "Marcar como pago", onSelect: () => void actions.markTransferPaid(t.id) }] : []),
                            { key: "cancel", label: "Cancelar repasse", description: "Deixa de consumir saldo; fica no histórico.", onSelect: () => setCancelling(t.id) },
                          ]}
                        />
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      <p className="text-[12px] text-subtle">Valores em reais, derivados dos recebimentos registrados. Não representam garantia de recebimento futuro.</p>

      {creating && manage && (
        <TransferDialog
          partnerOrganizationId={manage.partnerOrganizationId}
          available={summary.ok ? summary.data.totals.availableAmount : undefined}
          onClose={() => setCreating(false)}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title="Cancelar repasse"
          description="O repasse fica no histórico com o motivo e deixa de consumir o saldo do parceiro."
          confirmLabel="Cancelar repasse"
          onConfirm={(reason) => actions.cancelTransfer(cancelling, reason)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

/** Novo repasse: só o VALOR (e a referência). Quais divisões ele consome, o banco decide (026). */
function TransferDialog({ partnerOrganizationId, available, onClose }: { partnerOrganizationId: string; available?: number; onClose: () => void }) {
  const actions = useFinanceActions();
  const idempotency = useIdempotencyKey();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Registrar repasse"
      description={available !== undefined ? `Disponível para repasse: ${formatCurrency(available)}.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              const value = parseMoneyField(amount);
              if (!value || value <= 0) {
                setError("Informe um valor maior que zero.");
                return;
              }
              const input = { partnerOrganizationId, amount: value, reference: reference.trim() || undefined };
              setSaving(true);
              const r = await actions.createTransfer({ ...input, idempotencyKey: idempotency.keyFor(input) });
              setSaving(false);
              if (r.ok) {
                idempotency.reset();
                onClose();
              }
            }}
          >
            Registrar repasse
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Valor (R$)" requirement="required" error={error}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <Field label="Referência" requirement="optional" hint="Ex.: comprovante, número da transferência">
          {(p) => <Input {...p} maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
