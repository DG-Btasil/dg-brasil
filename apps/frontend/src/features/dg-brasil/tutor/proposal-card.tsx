"use client";

import { useState } from "react";
import { Ban, CheckCircle2 } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { usePermission } from "@/features/auth/hooks";
import { joinNames } from "../utils";
import { DiffDialog } from "../components/shared/diff-dialog";
import type { TutorMessage } from "./tutor-store";
import { useProposalStatus, useTutor } from "./use-tutor";

export function ProposalCard({ message }: { message: TutorMessage }) {
  const { apply, cancel } = useTutor();
  const { currentVersion, stale } = useProposalStatus(message);
  const [diffOpen, setDiffOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canManage = usePermission("dgbrasil.manage");
  const p = message.proposal;
  if (!p) return null;
  const affected = p.agentNames.length > 0 ? joinNames(p.agentNames) : "nenhum agente ativo";

  async function onApply() {
    setBusy(true);
    const ok = await apply(message);
    setBusy(false);
    if (ok) setConfirmOpen(false);
  }

  async function onCancel() {
    setBusy(true);
    await cancel(message);
    setBusy(false);
  }

  return (
    <div className="mt-2 rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-muted">Proposta de alteração</span>
        {p.state === "applied" && (
          <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>
            Aplicada
          </Badge>
        )}
        {p.state === "cancelled" && (
          <Badge tone="neutral" icon={<Ban className="size-3" aria-hidden />}>
            Cancelada
          </Badge>
        )}
        {p.state === "open" && <Badge tone="gold">Aguardando sua decisão</Badge>}
      </div>
      <dl className="space-y-2.5 px-3.5 py-3 text-[12.5px]">
        <Item label="Problema identificado">{p.proposal.problem}</Item>
        <Item label="Mudança proposta">{p.proposal.suggestedChange}</Item>
        <Item label="Impacto">{p.proposal.impact}</Item>
        <Item label="Agentes afetados">{affected}</Item>
      </dl>
      {stale && (
        <div className="px-3.5 pb-3">
          <Callout tone="warning">A Skill foi alterada depois desta proposta. Descreva o pedido novamente para receber uma proposta atualizada.</Callout>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-muted px-3.5 py-2.5 rounded-b-md">
        <Button size="sm" variant="secondary" onClick={() => setDiffOpen(true)}>
          Ver alterações
        </Button>
        {p.state === "open" && canManage && (
          <>
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={stale || busy}>
              Aplicar alteração
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancelar
            </Button>
          </>
        )}
        {p.state === "open" && !canManage && <span className="text-[12px] text-muted">Aplicar exige permissão de gestão do DG Brasil.</span>}
      </div>

      <DiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        title={`${p.skillName} · alterações propostas`}
        description={`${p.parameterLabel}: “${p.fromValue}” → “${p.toValue}”`}
        lines={p.proposal.diff}
      />
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title="Confirmar alteração"
        description={`A Skill ${p.skillName} passará da v${currentVersion} para a v${currentVersion + 1}. Esta alteração afetará: ${affected}.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Voltar
            </Button>
            <Button onClick={onApply} loading={busy}>
              Confirmar e aplicar
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted">
          A alteração fica registrada no Histórico de Alterações com o seu nome como solicitante. Tarefas já enviadas para Revisões não são modificadas.
        </p>
      </Dialog>
    </div>
  );
}

function Item({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.05em] text-subtle">{label}</dt>
      <dd className="mt-0.5 leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}
