import type { ReactNode } from "react";
import { Cpu, FolderArchive, Mail, MessageSquare, Radar, type LucideIcon } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { DefinitionGrid, Panel, PanelFooter } from "@/components/ui/panel";
import { Callout } from "@/components/feedback/states";
import { INTEGRATION_KIND_LABEL, INTEGRATION_STATUS_LABEL, INTEGRATION_STATUS_TONE, type IntegrationKind } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import type { Integration } from "@/types";

const KIND_ICON: Record<IntegrationKind, LucideIcon> = {
  AI_PROVIDER: Cpu,
  LEGAL_PROCESS: Radar,
  STORAGE: FolderArchive,
  EMAIL: Mail,
  WHATSAPP: MessageSquare,
};

/** Cartão de integração: status, última sincronização, detalhes e ações. */
export function IntegrationCard({ integration, actions, children }: { integration: Integration; actions?: ReactNode; children?: ReactNode }) {
  const Icon = KIND_ICON[integration.kind];
  const i = integration;
  return (
    <Panel className="flex flex-col">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-muted text-navy-700">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-semibold text-foreground">{i.name}</h3>
          <p className="text-[12px] text-muted">{INTEGRATION_KIND_LABEL[i.kind]}</p>
        </div>
        <StatusBadge status={i.status} labels={INTEGRATION_STATUS_LABEL} tones={INTEGRATION_STATUS_TONE} />
      </div>
      <div className="flex-1 space-y-3 px-5 py-4">
        <DefinitionGrid
          items={[
            { label: "Última sincronização", value: i.lastSyncAt ? <span className="tabular">{formatDateTime(i.lastSyncAt)}</span> : "Nunca sincronizado" },
            ...i.details.map((d) => ({ label: d.label, value: d.value })),
          ]}
        />
        {i.statusMessage && (
          <Callout tone={i.status === "ERROR" ? "danger" : i.status === "PENDING" ? "warning" : "neutral"}>{i.statusMessage}</Callout>
        )}
        {children}
      </div>
      {actions && <PanelFooter className="justify-start">{actions}</PanelFooter>}
    </Panel>
  );
}
