"use client";

import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import { CLIENT_POLE_LABEL } from "@/lib/constants/status";
import { formatCurrency, formatDate, formatDateTime, maskDocument } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import type { Page } from "@/server/core/pagination";
import type { ProcessInternalDTO, ProcessPartyDTO } from "@/server/domain/processes/dto";
import type { PartyType } from "@/server/domain/processes/schemas";
import { usePermission } from "@/features/auth/hooks";
import { CnjText } from "../cnj-text";

const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  PLAINTIFF: "Autor",
  DEFENDANT: "Réu",
  INTERESTED: "Interessado",
  OTHER: "Outro",
};

function OriginPanel({ process }: { process: ProcessInternalDTO }) {
  if (process.origin === "AGENT") {
    return (
      <Panel>
        <PanelBody className="flex items-start gap-2.5 text-[13px]">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
          <div>
            <p className="font-medium text-foreground">Origem: DG Brasil</p>
            <p className="mt-0.5 text-[12.5px] text-muted">Criado a partir de uma análise aprovada em Revisões.</p>
          </div>
        </PanelBody>
      </Panel>
    );
  }
  if (process.origin === "INTEGRATION") {
    return (
      <Panel>
        <PanelBody className="flex items-start gap-2.5 text-[13px]">
          <RefreshCw className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />
          <div>
            <p className="font-medium text-foreground">Sincronizado pelo provedor de acompanhamento processual</p>
            <p className="mt-0.5 text-[12.5px] text-muted">Movimentações do tribunal chegam automaticamente pela integração.</p>
          </div>
        </PanelBody>
      </Panel>
    );
  }
  return null;
}

/** Visão geral do processo (dados reais do servidor). */
export function OverviewTab({
  process: p,
  parties,
  responsibleName,
  lastMovementAt,
}: {
  process: ProcessInternalDTO;
  parties: ActionResult<Page<ProcessPartyDTO>>;
  responsibleName?: string;
  lastMovementAt?: string;
}) {
  const showValue = usePermission("processes.caseValue.view");
  const location = [p.district, p.state].filter(Boolean).join("/");
  const partyRows = parties.ok ? parties.data.items : [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-5">
      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Dados do processo" as="h3" />
          <PanelBody>
            <DefinitionGrid
              columns={3}
              items={[
                { label: "Número CNJ", value: <CnjText cnj={p.cnj} /> },
                { label: "Classe / tipo de ação", value: p.actionType },
                { label: "Assunto", value: p.subject },
                { label: "Tribunal", value: p.court },
                { label: "Unidade / vara", value: p.unit },
                { label: "Comarca / UF", value: location || undefined },
                {
                  label: "Caso",
                  value: (
                    <Link href={`/casos/${p.legalCaseId}`} className="text-navy hover:underline underline-offset-2">
                      {p.caseTitle || "Abrir caso"}
                    </Link>
                  ),
                },
                { label: "Responsável", value: responsibleName },
                ...(showValue ? [{ label: "Valor da causa", value: <span className="tabular">{formatCurrency(p.caseValue)}</span> }] : []),
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Partes" as="h3" />
          <PanelBody className="space-y-4">
            <DefinitionGrid
              items={[
                {
                  label: `Cliente${p.clientPole ? ` — ${CLIENT_POLE_LABEL[p.clientPole]}` : ""}`,
                  value: p.clientName ? (
                    <Link href={`/clientes/${p.clientId}`} className="text-navy hover:underline underline-offset-2">
                      {p.clientName}
                    </Link>
                  ) : (
                    <span className="text-muted">Cliente não disponível</span>
                  ),
                },
                { label: "Parte contrária", value: p.opposingParty },
              ]}
            />
            {!parties.ok ? (
              <p className="text-[12.5px] text-danger">Não foi possível carregar as partes cadastradas.</p>
            ) : (
              partyRows.length > 0 && (
                <div className="-mx-5 -mb-4 border-t border-line">
                  <Table caption="Partes cadastradas no processo">
                    <THead>
                      <tr>
                        <Th>Parte</Th>
                        <Th>Qualificação</Th>
                        <Th>Documento</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {partyRows.map((party) => (
                        <Tr key={party.id}>
                          <Td>
                            {party.clientId ? (
                              <Link href={`/clientes/${party.clientId}`} className="text-navy hover:underline underline-offset-2">
                                {party.name}
                              </Link>
                            ) : (
                              party.name
                            )}
                          </Td>
                          <Td className="text-[12.5px] text-muted">{PARTY_TYPE_LABEL[party.type]}</Td>
                          {/* Documento mascarado (minimização — LGPD). */}
                          <Td className="tabular text-[12.5px] text-muted">{party.document ? maskDocument(party.document) : "—"}</Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Resumo" as="h3" />
          <PanelBody className="space-y-3 text-[13px] leading-relaxed">
            {p.summary ? <p className="whitespace-pre-line text-foreground">{p.summary}</p> : <p className="text-subtle">Sem resumo registrado.</p>}
            {p.notes && (
              <div className="border-t border-line pt-3">
                <p className="eyebrow mb-1">Observações internas</p>
                <p className="whitespace-pre-line text-muted">{p.notes}</p>
              </div>
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Datas" as="h3" />
          <PanelBody>
            <DefinitionGrid
              columns={2}
              items={[
                { label: "Distribuição", value: p.distributionDate ? formatDate(p.distributionDate) : "Não distribuído" },
                { label: "Cadastro", value: formatDate(p.createdAt) },
                { label: "Última movimentação", value: lastMovementAt ? formatDateTime(lastMovementAt) : "—", wide: true },
              ]}
            />
          </PanelBody>
        </Panel>
        <OriginPanel process={p} />
      </div>
    </div>
  );
}
