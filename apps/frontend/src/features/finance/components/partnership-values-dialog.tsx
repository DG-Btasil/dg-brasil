"use client";

import { useEffect, useState } from "react";
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DefinitionGrid } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { getPartnerShareDetailAction } from "@/server/domain/finance/actions";
import type { PartnerShareDetailDTO } from "@/server/domain/finance/dto";
import { TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE } from "../labels";

/**
 * "Valores da parceria" de um caso (4.3.1) — SÓ LEITURA. Tudo derivado do
 * banco a partir dos recebimentos: não há campo para digitar valor do
 * parceiro nem para sobrescrever a divisão (decisão definitiva). O percentual
 * é o congelado no aceite; mudar a divisão padrão vale só para casos novos.
 */
export function PartnershipValuesDialog({ agreementId, caseTitle, internal, onClose }: { agreementId: string; caseTitle?: string; internal: boolean; onClose: () => void }) {
  const [result, setResult] = useState<ActionResult<PartnerShareDetailDTO> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    callAction(() => getPartnerShareDetailAction({ agreementId })).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [agreementId, version]);

  const d = result?.ok ? result.data : undefined;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title="Valores da parceria"
      description={caseTitle}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {!result ? (
        <SkeletonRows rows={4} />
      ) : !result.ok ? (
        <ActionErrorState error={result} onRetry={() => setVersion((v) => v + 1)} title="Não foi possível carregar os valores." />
      ) : d ? (
        <div className="space-y-5">
          <p className="text-[12.5px] text-muted">
            Divisão deste caso: <span className="font-medium text-foreground">{formatPercent(d.share.partnerPercentage)} parceiro</span> /{" "}
            {formatPercent(d.ownerPercentage)} escritório, registrada em {formatDate(d.share.effectiveAt)} e mantida mesmo se a divisão padrão mudar. Os valores são
            calculados pelo banco a partir dos recebimentos — não se digitam.
          </p>
          <DefinitionGrid
            columns={3}
            items={[
              { label: "Receita elegível", value: formatCurrency(d.share.eligibleRevenue) },
              { label: "Participação calculada", value: formatCurrency(d.share.accruedAmount) },
              ...(internal && d.ownerShare !== undefined ? [{ label: "Parte do escritório", value: formatCurrency(d.ownerShare) }] : []),
              { label: "Repassado", value: formatCurrency(d.share.paidOutAmount) },
              { label: "Em repasse", value: formatCurrency(d.share.pendingTransferAmount) },
              { label: "Saldo a repassar", value: formatCurrency(d.share.availableAmount) },
              ...(internal && d.caseReceived !== undefined ? [{ label: "Recebido no caso (total)", value: formatCurrency(d.caseReceived) }] : []),
            ]}
          />
          <section>
            <h3 className="mb-2 text-[13px] font-semibold text-foreground">Histórico de repasses deste caso</h3>
            {d.transfers.length === 0 ? (
              <EmptyState compact title="Nenhum repasse deste caso ainda." />
            ) : (
              <Table caption="Repasses deste caso">
                <THead>
                  <tr>
                    <Th>Registrado em</Th>
                    <Th>Referência</Th>
                    <Th className="text-right">Deste caso</Th>
                    <Th>Situação</Th>
                  </tr>
                </THead>
                <TBody>
                  {d.transfers.map((t) => (
                    <Tr key={t.transferId}>
                      <Td className="tabular text-muted">
                        {formatDate(t.createdAt)}
                        {t.paidAt && <span className="block text-[12px]">pago em {formatDate(t.paidAt)}</span>}
                      </Td>
                      <Td className="text-[12.5px]">{t.reference ?? "—"}</Td>
                      <Td className="text-right tabular">{formatCurrency(t.amount)}</Td>
                      <Td>
                        <StatusBadge status={t.status} labels={TRANSFER_STATUS_LABEL} tones={TRANSFER_STATUS_TONE} />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
          <p className="text-[12px] text-muted">O valor da causa é dado jurídico e não entra nesta divisão. A participação incide só sobre o que foi efetivamente recebido.</p>
        </div>
      ) : null}
    </Dialog>
  );
}
