"use client";

import Link from "next/link";
import { useState } from "react";
import { Banknote } from "lucide-react";
import { PARTNERSHIP_STATUS_LABEL, PARTNERSHIP_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/feedback/states";
import type { Client, ID, PartnershipAgreementView } from "@/types";
import { useCaseMap } from "@/features/cases/hooks";
import { clientDisplayName } from "@/features/processes/utils";
import { PartnershipValuesDialog, PayoutDialog } from "./partner-dialogs";

/**
 * Acordos de parceria por caso (visão interna). A divisão exibida é a do
 * PRÓPRIO caso (snapshot), que pode diferir da divisão padrão atual.
 */
export function PartnershipAgreementsTable({
  agreements,
  clientMap,
  partnerNames,
}: {
  agreements: PartnershipAgreementView[];
  clientMap: Map<ID, Client>;
  partnerNames?: Map<ID, string>;
}) {
  const caseMap = useCaseMap();
  const [dialog, setDialog] = useState<{ kind: "values" | "payout"; agreement: PartnershipAgreementView } | null>(null);
  if (agreements.length === 0) return <EmptyState compact icon={Banknote} title="Nenhum caso com acordo de parceria." />;
  return (
    <>
      <Table caption="Acordos de parceria por caso">
        <THead>
          <tr>
            <Th>Cliente / caso</Th>
            {partnerNames && <Th>Parceiro</Th>}
            <Th className="text-right">Divisão</Th>
            <Th className="text-right">Honorários</Th>
            <Th className="text-right">Parte do parceiro</Th>
            <Th className="text-right">Repassado</Th>
            <Th className="text-right">A repassar</Th>
            <Th>Situação</Th>
            <Th>
              <span className="sr-only">Ações</span>
            </Th>
          </tr>
        </THead>
        <TBody>
          {agreements.map((a) => {
            const legalCase = caseMap.get(a.legalCaseId);
            const client = legalCase ? clientMap.get(legalCase.clientId) : undefined;
            return (
              <Tr key={a.id}>
                <Td className="max-w-[260px]">
                  <div className="truncate font-medium text-foreground">{clientDisplayName(client)}</div>
                  {legalCase && (
                    <Link href={`/casos/${legalCase.id}?aba=financeiro`} className="block truncate text-[12px] text-navy-700 hover:underline underline-offset-2">
                      {legalCase.title}
                    </Link>
                  )}
                </Td>
                {partnerNames && <Td className="whitespace-nowrap text-[12.5px]">{partnerNames.get(a.partnerOfficeId)}</Td>}
                <Td className="whitespace-nowrap text-right text-[12.5px] tabular">
                  <Tooltip content={`Registrada em ${new Date(a.effectiveAt).toLocaleDateString("pt-BR")} e mantida mesmo se a divisão padrão mudar.`}>
                    <span tabIndex={0} className="cursor-help border-b border-dotted border-line-strong">
                      {a.partnerPercentage}% / {a.ownerPercentage}%
                    </span>
                  </Tooltip>
                </Td>
                <Td className="whitespace-nowrap text-right tabular">
                  {a.realizedRevenue !== undefined ? (
                    <>
                      {formatCurrency(a.realizedRevenue)}
                      <span className="block text-[11px] text-muted">realizados</span>
                    </>
                  ) : a.revenueBase !== undefined ? (
                    <>
                      <span className="text-muted">{formatCurrency(a.revenueBase)}</span>
                      <span className="block text-[11px] text-muted">estimados</span>
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right tabular">
                  {a.realizedPartnerAmount !== undefined ? (
                    formatCurrency(a.realizedPartnerAmount)
                  ) : a.estimatedPartnerAmount !== undefined ? (
                    <span className="text-muted">{formatCurrency(a.estimatedPartnerAmount)} (est.)</span>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="whitespace-nowrap text-right tabular">{formatCurrency(a.paidPartnerAmount)}</Td>
                <Td className="whitespace-nowrap text-right tabular font-medium">{a.pendingPartnerAmount ? formatCurrency(a.pendingPartnerAmount) : "—"}</Td>
                <Td>
                  <StatusBadge status={a.status} labels={PARTNERSHIP_STATUS_LABEL} tones={PARTNERSHIP_STATUS_TONE} />
                </Td>
                <Td className="text-right">
                  <Can permission="partners.finance.view">
                    <div className="flex flex-col items-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "values", agreement: a })}>
                        Valores
                      </Button>
                      {a.pendingPartnerAmount > 0 && (
                        <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: "payout", agreement: a })}>
                          Repasse
                        </Button>
                      )}
                    </div>
                  </Can>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
      {dialog?.kind === "values" && <PartnershipValuesDialog agreement={dialog.agreement} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog?.kind === "payout" && <PayoutDialog agreement={dialog.agreement} open onOpenChange={(o) => !o && setDialog(null)} />}
    </>
  );
}
