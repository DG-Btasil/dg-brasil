"use client";

import Link from "next/link";
import { RefreshCw, Sparkles } from "lucide-react";
import { ANALYSIS_STATUS_LABEL, ANALYSIS_STATUS_TONE, CLIENT_POLE_LABEL } from "@/lib/constants/status";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import type { Client, Process } from "@/types";
import { useAnalysis, useThesis } from "../../hooks";
import { hasPendingClientLink, processClientLabel } from "../../utils";
import { CnjText } from "../cnj-text";

function ThesisValue({ thesisId }: { thesisId?: string }) {
  const thesis = useThesis(thesisId);
  const canSeeDg = usePermission("dgbrasil.view");
  if (!thesis) return <span className="text-subtle">Nenhuma tese vinculada</span>;
  return canSeeDg ? (
    <Link href={`/dg-brasil/teses/${thesis.id}`} className="text-navy hover:underline underline-offset-2">
      {thesis.name}
    </Link>
  ) : (
    <span>{thesis.name}</span>
  );
}

function OriginPanel({ process }: { process: Process }) {
  const analysis = useAnalysis(process.analysisId);
  if (process.origin === "AGENT") {
    return (
      <Panel>
        <PanelHeader title="Origem: DG Brasil" as="h3" description="Criado a partir de uma análise aprovada em Revisões." />
        <PanelBody className="space-y-3 text-[13px]">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-gold-600" aria-hidden />
            <div className="min-w-0">
              {analysis ? (
                <>
                  <p className="text-foreground">Análise vinculada</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={analysis.status} labels={ANALYSIS_STATUS_LABEL} tones={ANALYSIS_STATUS_TONE} />
                    <span className="text-[12px] text-muted">Iniciada em {formatDate(analysis.createdAt)}</span>
                  </div>
                  <Link href={`/clientes/${process.clientId}?aba=analise`} className="mt-2 inline-block text-[12.5px] font-medium text-navy hover:underline underline-offset-2">
                    Abrir análise do cliente
                  </Link>
                </>
              ) : (
                <p className="text-muted">A análise de origem não está mais disponível.</p>
              )}
            </div>
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

export function OverviewTab({ process: p, client, responsibleName }: { process: Process; client?: Client; responsibleName?: string }) {
  const showValue = usePermission("processes.caseValue.view");
  const location = [p.district, p.state].filter(Boolean).join("/");

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
                { label: "Área", value: LEGAL_AREA_LABEL[p.area] },
                { label: "Tese", value: <ThesisValue thesisId={p.thesisId} /> },
                { label: "Responsável", value: responsibleName },
                ...(showValue ? [{ label: "Valor da causa", value: <span className="tabular">{formatCurrency(p.caseValue)}</span> }] : []),
              ]}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Partes" as="h3" />
          <PanelBody>
            <DefinitionGrid
              items={[
                {
                  label: `Cliente — ${CLIENT_POLE_LABEL[p.clientPole]}`,
                  value: hasPendingClientLink(p) ? (
                    <span className="text-warning">{processClientLabel(p, client)}</span>
                  ) : (
                    <Link href={`/clientes/${p.clientId}`} className="text-navy hover:underline underline-offset-2">
                      {processClientLabel(p, client)}
                    </Link>
                  ),
                },
                { label: "Parte contrária", value: p.opposingParty },
              ]}
            />
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
                { label: "Última movimentação", value: formatDateTime(p.lastMovementAt), wide: true },
              ]}
            />
          </PanelBody>
        </Panel>
        <OriginPanel process={p} />
        <Can permission="processes.edit">
          <p className="px-1 text-[12px] text-muted">A edição dos dados cadastrais estará disponível em uma próxima etapa.</p>
        </Can>
      </div>
    </div>
  );
}
