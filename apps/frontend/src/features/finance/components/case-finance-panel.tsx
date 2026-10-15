"use client";

import { useState } from "react";
import { formatDateTime, formatPercent } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import type { AgreementListItemDTO, CasePartnershipDTO } from "@/server/domain/finance/dto";
import { useOrganizationNames } from "@/features/directory/directory-context";
import { DEFAULT_AGREEMENT_QUERY } from "../list-query";
import { AgreementsPanel } from "./agreements-table";
import { PartnershipValuesDialog } from "./partnership-values-dialog";

/**
 * Financeiro do caso (ADMIN): contratos de honorários do caso, com obrigações
 * e ledger na gaveta, e o histórico da parceria (snapshot congelado no aceite,
 * gerado pelo banco). A divisão de cada recebimento é feita pelo banco.
 */
export function CaseFinancePanel({
  legalCaseId,
  agreements,
  partnerships,
}: {
  legalCaseId: string;
  agreements: ActionResult<Page<AgreementListItemDTO>>;
  partnerships: ActionResult<CasePartnershipDTO>;
}) {
  const names = useOrganizationNames();
  const [values, setValues] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <AgreementsPanel legalCaseId={legalCaseId} initialQuery={DEFAULT_AGREEMENT_QUERY} initialResult={agreements} title="Contratos de honorários do caso" />
      <Panel>
        <PanelHeader title="Parceria" description="Divisão registrada no aceite do caso de origem parceira. Mudar a divisão padrão do parceiro não altera este registro." />
        {!partnerships.ok ? (
          <ActionErrorState error={partnerships} title="Não foi possível carregar a parceria do caso." />
        ) : partnerships.data.surface !== "INTERNAL" || partnerships.data.items.length === 0 ? (
          <EmptyState compact title="Caso sem parceria registrada." description="Casos de origem interna não dividem honorários." />
        ) : (
          <Table caption="Parceria do caso">
            <THead>
              <tr>
                <Th>Parceiro</Th>
                <Th className="text-right">Parceiro</Th>
                <Th className="text-right">Escritório</Th>
                <Th>Vigência</Th>
                <Th>Situação</Th>
                <Th>
                  <span className="sr-only">Valores</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {partnerships.data.items.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium text-foreground">{names.get(p.partnerOrganizationId) ?? "Escritório parceiro"}</Td>
                  <Td className="text-right tabular">{formatPercent(p.partnerPercentage)}</Td>
                  <Td className="text-right tabular">{formatPercent(p.ownerPercentage)}</Td>
                  <Td className="text-[12.5px] text-muted">
                    desde {formatDateTime(p.effectiveAt)}
                    {p.cancelledAt && <span className="block">até {formatDateTime(p.cancelledAt)}</span>}
                  </Td>
                  <Td>
                    {p.status === "ACTIVE" ? <Badge tone="success">Ativa</Badge> : <Badge tone="neutral">Cancelada</Badge>}
                    {p.cancellationReason && <span className="block text-[12px] text-muted">{p.cancellationReason}</span>}
                  </Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setValues(p.id)}>
                      Valores
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>
      {values && <PartnershipValuesDialog agreementId={values} internal onClose={() => setValues(null)} />}
    </div>
  );
}
