"use client";

import { ShieldCheck } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { DOCUMENT_CATEGORY_LABEL, type DocumentCategory } from "@/lib/constants/status";
import type { AnalysisTemplate, Client } from "@/types";
import { clientDisplayName } from "@/features/clients/utils";
import { formatFieldValue } from "../../utils";

export function StepConfirm({
  template,
  client,
  values,
  missing,
  agentName,
}: {
  template: AnalysisTemplate;
  client: Client;
  values: Record<string, string>;
  missing: DocumentCategory[];
  agentName: string;
}) {
  return (
    <div className="max-w-[900px] space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">Confirmar</h2>
        <p className="mt-0.5 text-[13px] text-muted">Revise os dados antes de iniciar a análise.</p>
      </div>
      <Panel>
        <PanelHeader title="Resumo" as="h3" />
        <PanelBody className="space-y-5">
          <DefinitionGrid
            columns={3}
            items={[
              { label: "Cliente", value: clientDisplayName(client) },
              { label: "Modelo", value: template.name },
              { label: "Área", value: LEGAL_AREA_LABEL[template.area] },
              {
                label: "Documentação",
                value: missing.length ? `Pendente: ${missing.map((c) => DOCUMENT_CATEGORY_LABEL[c].toLowerCase()).join(", ")}` : "Completa",
                wide: true,
              },
            ]}
          />
          <div className="border-t border-line pt-4">
            <DefinitionGrid
              columns={3}
              items={template.fields.map((f) => ({ label: f.label, value: formatFieldValue(f, values[f.key]), wide: f.type === "textarea" }))}
            />
          </div>
        </PanelBody>
      </Panel>
      <Callout tone="neutral" title="O que acontece a seguir">
        <span className="inline-flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden />
          <span>
            {missing.length > 0
              ? "A análise ficará aguardando os documentos pendentes. Quando estiverem completos, poderá ser enviada ao agente. "
              : ""}
            {`O ${agentName} avaliará o material e enviará o resultado para Revisões. Nenhuma ação externa será tomada sem aprovação humana.`}
          </span>
        </span>
      </Callout>
    </div>
  );
}
