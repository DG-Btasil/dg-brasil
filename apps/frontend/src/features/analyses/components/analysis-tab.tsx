"use client";

import { FileSearch } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { ANALYSIS_STATUS_LABEL, ANALYSIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import type { LegalAnalysis } from "@/types";
import { useTemplates } from "../hooks";
import { currentAnalysis } from "../utils";
import { AnalysisDetail } from "./analysis-detail";

/** Análise jurídica do CASO. `newHref`: rota do assistente de nova análise. */
export function AnalysisTab({ newHref, analyses, onGoToDocuments }: { newHref: string; analyses: LegalAnalysis[]; onGoToDocuments: () => void }) {
  const canStart = usePermission("analyses.start");
  const templates = useTemplates();
  const current = currentAnalysis(analyses);

  if (!current) {
    return (
      <Panel>
        <EmptyState
          icon={FileSearch}
          title={ANALYSIS_STATUS_LABEL.NOT_STARTED}
          description="A análise jurídica verifica a documentação, coleta os dados da relação e envia o material ao agente da área. O resultado sempre passa por revisão humana antes de qualquer providência."
          action={
            canStart ? (
              <ButtonLink href={newHref}>Iniciar análise jurídica</ButtonLink>
            ) : (
              <p className="text-[12.5px] text-muted">Somente advogados e administradores podem iniciar análises.</p>
            )
          }
        />
      </Panel>
    );
  }

  const previous = analyses.filter((a) => a.id !== current.id);
  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? "Análise";

  return (
    <div className="space-y-5">
      <AnalysisDetail analysis={current} onGoToDocuments={onGoToDocuments} />
      {previous.length > 0 && (
        <Panel>
          <PanelHeader title="Análises anteriores" as="h3" />
          <Table caption="Análises anteriores do caso">
            <THead>
              <tr>
                <Th>Modelo</Th>
                <Th>Status</Th>
                <Th>Iniciada em</Th>
                <Th>Concluída em</Th>
              </tr>
            </THead>
            <TBody>
              {previous.map((a) => (
                <Tr key={a.id}>
                  <Td>{templateName(a.templateId)}</Td>
                  <Td>
                    <StatusBadge status={a.status} labels={ANALYSIS_STATUS_LABEL} tones={ANALYSIS_STATUS_TONE} />
                  </Td>
                  <Td className="tabular text-muted">{formatDate(a.startedAt ?? a.createdAt)}</Td>
                  <Td className="tabular text-muted">{formatDate(a.completedAt)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
