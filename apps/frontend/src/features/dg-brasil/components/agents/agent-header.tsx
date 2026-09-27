"use client";

import { useState } from "react";
import { Pause, Play } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Dialog } from "@/components/ui/dialog";
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import type { Agent } from "@/types";
import { useDgActions } from "../../hooks";
import { dgRoutes, formatVersion } from "../../utils";

export function AgentHeader({ agent }: { agent: Agent }) {
  const { updateAgent } = useDgActions();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pausing = agent.status === "ACTIVE";

  async function toggle() {
    setSaving(true);
    const ok = await updateAgent(agent.id, { status: pausing ? "PAUSED" : "ACTIVE" }, pausing ? `${agent.name} pausado` : `${agent.name} ativado`);
    setSaving(false);
    if (ok) setConfirmOpen(false);
  }

  return (
    <>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Agentes", href: dgRoutes.home }, { label: agent.name }]}
        title={agent.name}
        description={agent.role}
        meta={
          <>
            <StatusBadge status={agent.status} labels={AGENT_STATUS_LABEL} tones={AGENT_STATUS_TONE} />
            <span>Versão {formatVersion(agent.version)}</span>
            <span>Última execução: {agent.lastRunAt ? formatEventTime(agent.lastRunAt) : "sem execuções"}</span>
          </>
        }
        actions={
          <Can permission="dgbrasil.manage">
            <Button
              variant="secondary"
              icon={pausing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              onClick={() => setConfirmOpen(true)}
            >
              {pausing ? "Pausar agente" : "Ativar agente"}
            </Button>
          </Can>
        }
      />
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title={pausing ? `Pausar ${agent.name}?` : `Ativar ${agent.name}?`}
        description={
          pausing
            ? "O agente deixa de iniciar novas tarefas. Tarefas já enviadas para Revisões continuam disponíveis."
            : "O agente volta a receber tarefas conforme o nível de autonomia configurado."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Voltar
            </Button>
            <Button onClick={toggle} loading={saving}>
              {pausing ? "Pausar agente" : "Ativar agente"}
            </Button>
          </>
        }
      />
    </>
  );
}
