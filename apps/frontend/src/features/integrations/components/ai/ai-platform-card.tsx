"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { INTEGRATION_STATUS_LABEL, INTEGRATION_STATUS_TONE } from "@/lib/constants/status";
import { formatCompact, formatDateTime, formatNumber, formatUsd } from "@/lib/formatting";
import type { AIUsage, Integration } from "@/types";
import { ManageConnectionDialog } from "./manage-connection-dialog";

export function AiPlatformCard({ usage, integration, topAgent }: { usage: AIUsage; integration?: Integration; topAgent?: { name: string; tokens: number } }) {
  const [managing, setManaging] = useState(false);
  const status = integration?.status ?? "CONNECTED";
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Claude Platform <StatusBadge status={status} labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
          </span>
        }
        description="Provedor de IA dos agentes do escritório (Anthropic)."
        actions={
          <Button size="sm" variant="secondary" icon={<Settings2 className="size-3.5" aria-hidden />} onClick={() => setManaging(true)}>
            Gerenciar conexão
          </Button>
        }
      />
      <PanelBody>
        <DefinitionGrid
          columns={4}
          items={[
            { label: "Organização", value: usage.organization },
            { label: "Modelo principal", value: <code className="text-[12.5px]">{usage.primaryModel}</code> },
            {
              label: "Consumo no mês",
              value: (
                <span className="tabular" title={`${formatNumber(usage.inputTokens)} de entrada · ${formatNumber(usage.outputTokens)} de saída`}>
                  {formatCompact(usage.inputTokens)} entrada · {formatCompact(usage.outputTokens)} saída
                </span>
              ),
            },
            { label: "Custo estimado", value: <span className="tabular">{formatUsd(usage.estimatedCostUsd)}</span> },
            { label: "Agente com maior consumo", value: topAgent ? `${topAgent.name} (${formatCompact(topAgent.tokens)} tokens)` : null },
            { label: "Última sincronização", value: <span className="tabular">{formatDateTime(usage.lastSyncAt)}</span> },
            { label: "Credencial", value: "Gerenciada no backend (não armazenada no navegador)", wide: true },
          ]}
        />
      </PanelBody>
      <ManageConnectionDialog open={managing} onOpenChange={setManaging} />
    </Panel>
  );
}
