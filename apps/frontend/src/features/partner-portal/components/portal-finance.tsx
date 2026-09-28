"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Banknote } from "lucide-react";
import { PARTNERSHIP_STATUS_LABEL, PARTNERSHIP_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatDate } from "@/lib/formatting";
import { PageContainer } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/feedback/states";
import { useCurrentPartnerOfficeId } from "@/features/auth/hooks";
import { usePartnerFinancialSummary, usePartnershipViews } from "@/features/partners/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { usePortalClientMap, usePortalProcesses } from "../hooks";

/**
 * Financeiro do parceiro (somente administrador do parceiro): participação
 * do próprio escritório. Não mostra financeiro global, custos internos nem
 * outros parceiros — esses dados não chegam ao portal.
 */
export function PortalFinance() {
  const partnerOfficeId = useCurrentPartnerOfficeId();
  const summary = usePartnerFinancialSummary(partnerOfficeId);
  const views = usePartnershipViews();
  const processes = usePortalProcesses();
  const clientMap = usePortalClientMap();
  const processMap = useMemo(() => new Map(processes.map((p) => [p.id, p])), [processes]);
  const payouts = useMemo(
    () =>
      views
        .flatMap((v) => v.payouts.map((p) => ({ ...p, processId: v.processId })))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 5),
    [views],
  );

  return (
    <PageContainer>
      <PageHeader title="Financeiro" description="Sua participação nos honorários dos casos enviados à Bárbara Cardoso Advocacia." />
      {summary && (
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Participação acumulada" value={formatCurrency(summary.accumulatedShare)} hint="Sobre honorários já realizados" icon={Banknote} />
          <Stat label="Recebido" value={formatCurrency(summary.received)} />
          <Stat label="A receber" value={formatCurrency(summary.toReceive)} tone={summary.toReceive ? "gold" : "neutral"} />
          <Stat label="Participação estimada" value={formatCurrency(summary.estimatedShare)} hint="Estimativa — não é garantia" />
        </div>
      )}

      <Panel className="mt-5">
        <PanelHeader title="Processos com valores" />
        {views.length === 0 ? (
          <EmptyState compact title="Nenhum caso com valores registrados." />
        ) : (
          <Table caption="Participação por processo">
            <THead>
              <tr>
                <Th>Cliente</Th>
                <Th>Processo</Th>
                <Th className="text-right">Honorários</Th>
                <Th className="text-right">Participação</Th>
                <Th className="text-right">Recebido</Th>
                <Th className="text-right">Pendente</Th>
                <Th>Situação</Th>
              </tr>
            </THead>
            <TBody>
              {views.map((v) => {
                const process = processMap.get(v.processId);
                const realized = v.realizedRevenue !== undefined;
                return (
                  <Tr key={v.id}>
                    <Td className="text-[12.5px]">{process ? clientDisplayName(clientMap.get(process.clientId)) : "—"}</Td>
                    <Td>
                      {process ? (
                        <Link href={`/processos/${process.id}?aba=financeiro`} className="font-medium text-navy hover:underline underline-offset-2">
                          {process.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular">
                      {realized ? formatCurrency(v.realizedRevenue) : v.revenueBase !== undefined ? <span className="text-muted">{formatCurrency(v.revenueBase)} (estimado)</span> : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular">
                      <Tooltip content={`Participação deste caso: ${v.partnerPercentage}%`}>
                        <span tabIndex={0}>
                          {realized ? formatCurrency(v.realizedPartnerAmount) : v.estimatedPartnerAmount !== undefined ? <span className="text-muted">{formatCurrency(v.estimatedPartnerAmount)} (estimada)</span> : "—"}
                        </span>
                      </Tooltip>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular">{formatCurrency(v.paidPartnerAmount)}</Td>
                    <Td className="whitespace-nowrap text-right tabular font-medium">{v.pendingPartnerAmount ? formatCurrency(v.pendingPartnerAmount) : "—"}</Td>
                    <Td>
                      <StatusBadge status={v.status} labels={PARTNERSHIP_STATUS_LABEL} tones={PARTNERSHIP_STATUS_TONE} />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel className="mt-5">
        <PanelHeader title="Repasses registrados" description="Registros informados pela Bárbara Cardoso Advocacia." />
        {payouts.length === 0 ? (
          <EmptyState compact title="Nenhum repasse registrado." />
        ) : (
          <ul className="divide-y divide-line">
            {payouts.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-[13px]">
                <span>
                  {processMap.get(p.processId)?.title ?? "Processo"} <span className="text-muted">· {formatDate(p.at)}</span>
                </span>
                <span className="font-medium tabular">{formatCurrency(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="mt-4 text-[12px] text-subtle">Valores estimados podem mudar ao longo do caso e não representam garantia de recebimento.</p>
    </PageContainer>
  );
}
