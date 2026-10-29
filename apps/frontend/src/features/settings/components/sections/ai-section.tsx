"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Monitor, Plus, Power, PowerOff } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatDateTime, formatEventTime, formatNumber } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import { createExecutorAction, getAiStatusAction, getOfficeStatusAction, revokeExecutorAction, setAiEnabledAction } from "@/server/domain/dg/actions";
import type { AiRuntimeStatusDTO, CreatedExecutorDTO, ExecutorDTO, OfficeStatusDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { SectionHeader } from "../section-header";

/**
 * Computador do escritório (040). Os agentes rodam no Claude Code de um
 * computador do escritório, que se conecta ao DG Brasil com um token próprio
 * (só o hash fica no banco). Aqui: se há computador conectado, a fila, o
 * interruptor geral e — para o ADMIN — autorizar e revogar computadores.
 */
export function AiSection() {
  const isAdmin = usePermission("dgbrasil.manage");
  const [status, setStatus] = useState<ActionResult<AiRuntimeStatusDTO> | null>(null);
  const [office, setOffice] = useState<ActionResult<OfficeStatusDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    Promise.all([callAction(() => getAiStatusAction()), callAction(() => getOfficeStatusAction())]).then(([s, o]) => {
      if (!alive) return;
      setStatus(s);
      setOffice(o);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Computador do escritório"
        description="Os agentes trabalham no Claude Code de um computador do escritório. O DG Brasil guarda os dados, a fila e a revisão humana."
      />
      {!office ? <SkeletonRows rows={3} /> : !office.ok ? <ActionErrorState error={office} title="Não foi possível ler a situação do escritório." /> : <OfficePanel o={office.data} />}
      {!status ? null : !status.ok ? <ActionErrorState error={status} title="Não foi possível ler o interruptor." /> : <KillSwitch status={status.data} canToggle={isAdmin} onChanged={load} />}
      {isAdmin && office?.ok && <Executors list={office.data.executors ?? []} onChanged={load} />}
    </div>
  );
}

function OfficePanel({ o }: { o: OfficeStatusDTO }) {
  return (
    <Panel>
      <PanelHeader
        title="Situação"
        description="Conectado = o Claude Code está aberto em um computador autorizado, com o DG Brasil ligado."
        actions={<Badge tone={o.online ? "success" : "neutral"}>{o.online ? "Computador conectado" : "Nenhum computador conectado"}</Badge>}
      />
      <PanelBody className="space-y-3">
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Último contato", value: o.lastSeenAt ? formatEventTime(o.lastSeenAt) : "Nunca" },
            { label: "Na fila", value: formatNumber(o.queued) },
            { label: "Em andamento", value: formatNumber(o.running) },
          ]}
        />
        {!o.online && o.queued > 0 && (
          <Callout tone="info">
            Há trabalhos esperando. Para processar, alguém no escritório abre o Claude Code e digita <code className="font-mono">/mcp__dg-brasil__trabalhos</code>.
          </Callout>
        )}
      </PanelBody>
    </Panel>
  );
}

function KillSwitch({ status, canToggle, onChanged }: { status: AiRuntimeStatusDTO; canToggle: boolean; onChanged: () => void }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const on = status.executionEnabled;

  async function toggle() {
    setSaving(true);
    const r = await callAction(() => setAiEnabledAction({ enabled: !on, reason: reason || undefined }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível mudar a execução.");
      return;
    }
    setOpen(false);
    setReason("");
    toast({
      tone: on ? "warning" : "success",
      title: on ? "Execução pelo escritório desligada" : "Execução pelo escritório ligada",
      description: on ? "Nenhum trabalho novo é reservado; os pedidos ficam na fila." : "Computadores autorizados voltam a poder reservar trabalhos.",
    });
    onChanged();
  }

  return (
    <Panel>
      <PanelHeader
        title="Interruptor geral"
        description="Desligado, nenhum computador consegue reservar trabalho novo, mesmo com o Claude Code aberto. Os pedidos ficam na fila."
        actions={<Badge tone={on ? "success" : "danger"}>{on ? "Ligado" : "Desligado"}</Badge>}
      />
      <PanelBody className="space-y-3">
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Situação", value: on ? "Trabalhos podem ser reservados" : "Trabalhos ficam na fila" },
            { label: "Última mudança", value: status.updatedAt ? `${formatDateTime(status.updatedAt)}${status.updatedByName ? ` · ${status.updatedByName}` : ""}` : "—" },
            { label: "Motivo", value: status.reason },
          ]}
        />
        {canToggle ? (
          <Button variant={on ? "danger" : "primary"} icon={on ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            {on ? "Desligar a execução" : "Ligar a execução"}
          </Button>
        ) : (
          <p className="text-[12.5px] text-muted">Só o administrador liga ou desliga.</p>
        )}
      </PanelBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={on ? "Desligar a execução pelo escritório?" : "Ligar a execução pelo escritório?"}
        description={
          on
            ? "Nenhum trabalho novo é reservado. O que estiver em andamento termina; os pedidos ficam na fila até religar."
            : "Computadores autorizados passam a poder reservar trabalhos da fila. Use dados fictícios até a revisão LGPD do provedor de IA."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button variant={on ? "danger" : "primary"} loading={saving} onClick={toggle}>
              {on ? "Desligar" : "Ligar"}
            </Button>
          </>
        }
      >
        <Field label="Motivo" requirement="optional">
          {(a) => <Input {...a} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: teste controlado no DEV" />}
        </Field>
      </Dialog>
    </Panel>
  );
}

function Executors({ list, onChanged }: { list: ExecutorDTO[]; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ExecutorDTO | null>(null);
  return (
    <Panel>
      <PanelHeader
        title="Computadores autorizados"
        description="Cada computador tem um token próprio, mostrado uma única vez. Revogar corta o acesso na hora e devolve à fila o que ele tinha reservado."
        actions={
          <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            Autorizar computador
          </Button>
        }
      />
      {list.length === 0 ? (
        <EmptyState icon={Monitor} title="Nenhum computador autorizado." description="Autorize o computador do escritório e siga o guia de instalação (docs/mcp/instalacao.md)." />
      ) : (
        <Table caption="Computadores autorizados">
          <THead>
            <tr>
              <Th>Computador</Th>
              <Th>Token</Th>
              <Th>Último contato</Th>
              <Th>Versão</Th>
              <Th className="text-right">Em andamento</Th>
              <Th>Situação</Th>
              <Th className="text-right">Ações</Th>
            </tr>
          </THead>
          <TBody>
            {list.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium text-foreground">{e.name}</Td>
                <Td className="font-mono text-[12px] text-muted">{e.tokenPrefix}…</Td>
                <Td className="text-muted">{e.lastSeenAt ? formatEventTime(e.lastSeenAt) : "Nunca"}</Td>
                <Td className="text-[12px] text-muted">{e.clientVersion ?? "—"}</Td>
                <Td className="text-right tabular">{formatNumber(e.running)}</Td>
                <Td>
                  {e.revokedAt ? <Badge tone="neutral">Revogado</Badge> : e.online ? <Badge tone="success">Conectado</Badge> : <Badge tone="gold">Desconectado</Badge>}
                </Td>
                <Td className="text-right">
                  {!e.revokedAt && (
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(e)}>
                      Revogar
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
      {creating && <CreateExecutorDialog onClose={() => setCreating(false)} onCreated={onChanged} />}
      {revoking && <RevokeDialog executor={revoking} onClose={() => setRevoking(null)} onDone={onChanged} />}
    </Panel>
  );
}

function CreateExecutorDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const failed = useActionFeedback();
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<CreatedExecutorDTO | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    if (!name.trim()) {
      setError("Dê um nome ao computador.");
      return;
    }
    setSaving(true);
    const r = await callAction(() => createExecutorAction({ name: name.trim() }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível autorizar o computador.");
      return;
    }
    setCreated(r.data);
    onCreated();
  }

  const config = created
    ? JSON.stringify({ url: typeof window !== "undefined" ? window.location.origin : "", token: created.token }, null, 2)
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(config);
      setCopied(true);
    } catch {
      toast({ tone: "warning", title: "Não foi possível copiar", description: "Selecione o texto e copie à mão." });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={created ? `Token do ${created.name}` : "Autorizar computador"}
      description={
        created
          ? "Copie agora: este token não aparece de novo. Cole no arquivo de configuração do computador, como mostra o guia de instalação."
          : "Dê um nome para reconhecer o computador na lista (ex.: Computador da recepção)."
      }
      footer={
        created ? (
          <Button onClick={onClose}>Já copiei</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={create}>
              Gerar token
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted">
            Conteúdo do arquivo <code className="font-mono">%APPDATA%\DGBrasil\executor.json</code> no computador:
          </p>
          <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-foreground">{config}</pre>
          <Button variant="secondary" size="sm" icon={<Copy className="size-4" aria-hidden />} onClick={copy}>
            {copied ? "Copiado" : "Copiar"}
          </Button>
          <Callout tone="warning">Quem tiver este token consegue reservar trabalhos do escritório. Não mande por e-mail ou WhatsApp. Perdeu ou vazou: revogue e gere outro.</Callout>
        </div>
      ) : (
        <Field label="Nome do computador" requirement="required" error={error}>
          {(a) => <Input {...a} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setError(undefined); }} placeholder="Computador da recepção" />}
        </Field>
      )}
    </Dialog>
  );
}

function RevokeDialog({ executor, onClose, onDone }: { executor: ExecutorDTO; onClose: () => void; onDone: () => void }) {
  const failed = useActionFeedback();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  async function revoke() {
    setSaving(true);
    const r = await callAction(() => revokeExecutorAction({ id: executor.id }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível revogar.");
      return;
    }
    toast({ tone: "success", title: `${executor.name} revogado`, description: r.data.released ? `${r.data.released} trabalho(s) voltaram para a fila.` : undefined });
    onClose();
    onDone();
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="sm"
      title={`Revogar ${executor.name}?`}
      description="O token para de funcionar na hora e não volta a valer. O que este computador tinha reservado volta para a fila."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button variant="danger" loading={saving} onClick={revoke}>
            Revogar
          </Button>
        </>
      }
    />
  );
}
