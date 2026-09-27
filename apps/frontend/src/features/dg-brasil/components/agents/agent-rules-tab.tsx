"use client";

import { useState } from "react";
import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import type { Agent } from "@/types";
import { useDgActions } from "../../hooks";

const LOCKED_RULE = "Ações externas (protocolos, mensagens a clientes, envios a terceiros) sempre exigem confirmação humana.";

export function AgentRulesTab({ agent }: { agent: Agent }) {
  const canManage = usePermission("dgbrasil.manage");
  const { updateAgent } = useDgActions();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  function startEdit(index: number | "new") {
    setEditing(index);
    setDraft(index === "new" ? "" : (agent.rules[index] ?? ""));
  }

  async function save() {
    const text = draft.trim();
    if (!text || editing === null) return;
    const rules = editing === "new" ? [...agent.rules, text] : agent.rules.map((r, i) => (i === editing ? text : r));
    setBusy(true);
    const ok = await updateAgent(agent.id, { rules }, editing === "new" ? "Regra adicionada" : "Regra atualizada");
    setBusy(false);
    if (ok) setEditing(null);
  }

  async function confirmRemove() {
    if (removing === null) return;
    setBusy(true);
    const ok = await updateAgent(agent.id, { rules: agent.rules.filter((_, i) => i !== removing) }, "Regra removida");
    setBusy(false);
    if (ok) setRemoving(null);
  }

  const editor = (
    <div className="space-y-2">
      <label htmlFor="rule-editor" className="sr-only">
        Texto da regra
      </label>
      <Textarea
        id="rule-editor"
        rows={2}
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ex.: Nunca enviar minuta sem conferir a qualificação das partes."
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
          Cancelar
        </Button>
        <Button size="sm" onClick={save} disabled={!draft.trim()} loading={busy}>
          Salvar regra
        </Button>
      </div>
    </div>
  );

  return (
    <Panel>
      <PanelHeader
        title="Regras de comportamento"
        description="Instruções permanentes que o agente segue em todas as tarefas."
        actions={
          canManage && editing === null ? (
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => startEdit("new")}>
              Adicionar regra
            </Button>
          ) : undefined
        }
      />
      <ol className="divide-y divide-line">
        <li className="flex items-start gap-3 bg-surface-muted px-5 py-3">
          <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-navy-700" />
          <p className="flex-1 text-[13px] text-foreground">{LOCKED_RULE}</p>
          <Badge tone="navy" icon={<Lock className="size-3" aria-hidden />}>
            Regra fixa do sistema
          </Badge>
        </li>
        {agent.rules.map((rule, i) => (
          <li key={`${i}-${rule}`} className="flex items-start gap-3 px-5 py-3">
            <span className="mt-0.5 w-4 shrink-0 text-right text-[12px] tabular text-subtle">{i + 1}.</span>
            {editing === i ? (
              <div className="flex-1">{editor}</div>
            ) : (
              <>
                <p className="flex-1 text-[13px] text-foreground">{rule}</p>
                {canManage && editing === null && (
                  <div className="flex shrink-0 gap-1">
                    <IconButton size="sm" label={`Editar regra ${i + 1}`} onClick={() => startEdit(i)}>
                      <Pencil className="size-3.5" aria-hidden />
                    </IconButton>
                    <IconButton size="sm" label={`Remover regra ${i + 1}`} onClick={() => setRemoving(i)}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </IconButton>
                  </div>
                )}
              </>
            )}
          </li>
        ))}
        {editing === "new" && <li className="px-5 py-3">{editor}</li>}
      </ol>
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        size="sm"
        title="Remover esta regra?"
        description={removing !== null ? `“${agent.rules[removing] ?? ""}”` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Voltar
            </Button>
            <Button variant="danger" onClick={confirmRemove} loading={busy}>
              Remover regra
            </Button>
          </>
        }
      />
    </Panel>
  );
}
