"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { INTEGRATION_STATUS_LABEL, INTEGRATION_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import type { AIUsage, Integration } from "@/types";
import { ManageConnectionDialog } from "./manage-connection-dialog";

/** Conexão Claude: status, uso, execuções e limites. Sem tokens nem custo na interface. */
export function AiPlatformCard({ usage, integration, topAgent }: { usage: AIUsage; integration?: Integration; topAgent?: { name: string; runs: number } }) {
  const [managing, setManaging] = useState(false);
  const status = integration?.status ?? "CONNECTED";
  const limitShare = usage.runLimit ? Math.round((usage.runs / usage.runLimit) * 100) : undefined;
  return (
    <Panel>
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            Conexão Claude <StatusBadge status={status} labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
          </span>
        }
        description="Provedor de IA dos agentes do escritório. Configuração e credencial gerenciadas pelo backend."
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
            { label: "Execuções no mês", value: <span className="tabular">{formatNumber(usage.runs)}</span> },
            {
              label: "Limite mensal",
              value: usage.runLimit ? (
                <span className="tabular">
                  {formatNumber(usage.runLimit)} execuções{limitShare !== undefined ? ` · ${limitShare}% utilizado` : ""}
                </span>
              ) : (
                "Definido no backend"
              ),
            },
            { label: "Agente mais ativo", value: topAgent ? `${topAgent.name} (${formatNumber(topAgent.runs)} execuções)` : null },
            { label: "Última sincronização", value: <span className="tabular">{formatDateTime(usage.lastSyncAt)}</span> },
            { label: "Credencial", value: "Gerenciada no backend (não armazenada no navegador)", wide: true },
          ]}
        />
      </PanelBody>
      <ManageConnectionDialog open={managing} onOpenChange={setManaging} />
    </Panel>
  );
}
