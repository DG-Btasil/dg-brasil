"use client";

import { History } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatDateTime } from "@/lib/formatting";
import { AUDIT_ACTION_LABEL } from "@/types/audit";
import { useClientActivity } from "../../hooks";

export function ActivityTab({ clientId }: { clientId: string }) {
  const events = useClientActivity(clientId);
  return (
    <Panel className="max-w-[880px]">
      <PanelHeader title="Atividade" description="Registro de auditoria do cliente, seus documentos e análises." />
      <PanelBody>
        {events.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma atividade registrada." compact />
        ) : (
          <Timeline
            items={events.map((e) => ({
              id: e.id,
              title: AUDIT_ACTION_LABEL[e.action],
              description: (
                <>
                  {e.description} <span className="text-subtle">· {e.actor.name}</span>
                </>
              ),
              meta: formatDateTime(e.at),
              tone: e.actor.type === "AGENT" ? "navy" : "neutral",
            }))}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
