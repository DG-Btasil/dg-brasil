"use client";

import { StatusBadge } from "@/components/ui/badge";
import { Steps, Timeline } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { ANALYSIS_STATUS_LABEL, ANALYSIS_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { useUserMap } from "@/features/offices/hooks";
import type { LegalAnalysis } from "@/types";
import { useTemplate } from "../hooks";
import { formatFieldValue, STEP_STATE } from "../utils";
import { AnalysisStatusPanel } from "./analysis-status-panel";

export function AnalysisDetail({ analysis, onGoToDocuments }: { analysis: LegalAnalysis; onGoToDocuments: () => void }) {
  const template = useTemplate(analysis.templateId);
  const users = useUserMap();
  const startedBy = analysis.startedBy ? users.get(analysis.startedBy)?.name : undefined;
  const timeline = [...analysis.timeline].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-5">
      <div className="space-y-5">
        <Panel>
          <PanelHeader
            eyebrow={template ? LEGAL_AREA_LABEL[template.area] : undefined}
            title={
              <span className="flex items-center gap-2.5">
                {template?.name ?? "Análise jurídica"}
                <StatusBadge status={analysis.status} labels={ANALYSIS_STATUS_LABEL} tones={ANALYSIS_STATUS_TONE} />
              </span>
            }
            description={`Iniciada em ${formatDateTime(analysis.startedAt ?? analysis.createdAt)}${startedBy ? ` por ${startedBy}` : ""}.`}
          />
          <PanelBody className="space-y-5">
            <Steps steps={analysis.steps.map((s) => ({ key: s.key, label: s.label, state: STEP_STATE[s.status], description: s.at ? formatDateTime(s.at) : undefined }))} />
            <AnalysisStatusPanel analysis={analysis} template={template} onGoToDocuments={onGoToDocuments} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader title="Dados informados" description="Dados específicos da relação analisada. Pertencem à análise, não ao cadastro do cliente." as="h3" />
          <PanelBody>
            {template && template.fields.length > 0 ? (
              <DefinitionGrid
                columns={3}
                items={template.fields.map((f) => ({
                  label: f.label,
                  value: formatFieldValue(f, analysis.fields[f.key]),
                  wide: f.type === "textarea",
                }))}
              />
            ) : (
              <p className="text-[13px] text-muted">Este modelo não possui campos específicos.</p>
            )}
          </PanelBody>
        </Panel>
      </div>
      <Panel>
        <PanelHeader title="Histórico da análise" as="h3" />
        <PanelBody>
          <Timeline
            items={timeline.map((e, i) => ({
              id: e.id,
              title: e.message,
              description: e.actor.name,
              meta: formatDateTime(e.at),
              tone: e.actor.type === "AGENT" ? "navy" : "neutral",
              highlight: i === 0,
            }))}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
