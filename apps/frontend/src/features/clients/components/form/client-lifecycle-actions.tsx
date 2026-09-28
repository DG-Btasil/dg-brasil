"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserCheck, UserX } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { Callout } from "@/components/feedback/states";
import { formatDateTime, pluralize } from "@/lib/formatting";
import {
  CLIENT_INACTIVATION_REASONS,
  CLIENT_INACTIVATION_REASON_LABEL,
  type Client,
  type ClientInactivationReason,
} from "@/types";
import { useClientLifecycleActions, useClientProcesses } from "../../hooks";
import { clientDisplayName } from "../../utils";

const CONFIRM_WORD = "EXCLUIR";

/** Inativar (preferencial): sai da operação, continua no histórico e pesquisável. */
function InactivateDialog({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const { inactivate } = useClientLifecycleActions();
  const [reason, setReason] = useState<ClientInactivationReason | "">("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const ok = await inactivate(client, {
      reason: reason || undefined,
      note: note.trim() || undefined,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Inativar cliente"
      description={`${clientDisplayName(client)} deixará de aparecer como cliente ativo, mas continua pesquisável, com documentos, processos e histórico preservados. É possível reativar depois.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={<UserX className="size-4" aria-hidden />}
            loading={saving}
            onClick={confirm}
          >
            Inativar cliente
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Motivo" requirement="optional">
          {(a) => (
            <Select
              {...a}
              value={reason}
              onChange={(e) =>
                setReason(e.target.value as ClientInactivationReason | "")
              }
              placeholder="Selecione, se quiser"
              options={CLIENT_INACTIVATION_REASONS.map((r) => ({
                value: r,
                label: CLIENT_INACTIVATION_REASON_LABEL[r],
              }))}
            />
          )}
        </Field>
        <Field label="Observação" requirement="optional">
          {(a) => (
            <Textarea
              {...a}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/** Exclusão: confirmação forte. Processos NÃO são excluídos. */
function DeleteDialog({
  client,
  onClose,
}: {
  client: Client;
  onClose: () => void;
}) {
  const router = useRouter();
  const { remove } = useClientLifecycleActions();
  const processes = useClientProcesses(client.id);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const ok = await remove(client);
    setSaving(false);
    if (ok) router.push("/clientes");
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Excluir cliente"
      description="Tem certeza de que deseja excluir este cliente?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="border-danger bg-danger text-white hover:bg-danger/90"
            icon={<Trash2 className="size-4" aria-hidden />}
            loading={saving}
            disabled={typed.trim().toUpperCase() !== CONFIRM_WORD}
            onClick={confirm}
          >
            Excluir definitivamente
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px]">
        <p>
          <strong>{clientDisplayName(client)}</strong> será removido da lista de
          clientes. Se o objetivo é só encerrar o relacionamento, prefira{" "}
          <strong>Inativar</strong>: o cadastro continua no histórico e
          pesquisável.
        </p>
        {processes.length > 0 ? (
          <Callout
            tone="warning"
            title={`${pluralize(processes.length, "processo vinculado", "processos vinculados")} — não serão excluídos`}
          >
            <p>
              Cliente e processo são independentes. Os processos abaixo
              continuam no sistema com o alerta “Cliente associado removido —
              revisão necessária” até que outro cliente seja vinculado.
            </p>
            <ul className="mt-1.5 list-disc pl-4">
              {processes.map((p) => (
                <li key={p.id}>{p.title}</li>
              ))}
            </ul>
          </Callout>
        ) : (
          <Callout tone="neutral">
            Nenhum processo está vinculado a este cliente.
          </Callout>
        )}
        <Field
          label={`Para confirmar, digite ${CONFIRM_WORD}`}
          requirement="required"
        >
          {(a) => (
            <Input
              {...a}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

/**
 * Seções de "Editar cadastro": situação do cadastro (inativar/reativar) e
 * área de ações perigosas (excluir). A exclusão nunca é o CTA principal.
 */
export function ClientLifecycleActions({ client }: { client: Client }) {
  const { reactivate } = useClientLifecycleActions();
  const [dialog, setDialog] = useState<"inactivate" | "delete" | null>(null);
  const inactive = client.status === "INACTIVE";

  return (
    <div className="mt-6 space-y-4">
      <Panel className="flex items-center justify-between gap-6 px-6 py-5">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">
            Situação do cadastro
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {inactive
              ? `Inativo desde ${client.inactivation ? formatDateTime(client.inactivation.at) : "—"}${client.inactivation?.reason ? ` · ${CLIENT_INACTIVATION_REASON_LABEL[client.inactivation.reason]}` : ""}.`
              : "Quando alguém deixa de ser cliente, inative o cadastro: ele sai da operação e permanece no histórico."}
          </p>
        </div>
        {inactive ? (
          <Button
            variant="secondary"
            icon={<UserCheck className="size-4" aria-hidden />}
            onClick={() => reactivate(client)}
          >
            Reativar cliente
          </Button>
        ) : (
          <Button
            variant="secondary"
            icon={<UserX className="size-4" aria-hidden />}
            onClick={() => setDialog("inactivate")}
          >
            Inativar cliente
          </Button>
        )}
      </Panel>

      <Can permission="clients.delete">
        <section
          aria-labelledby="danger-zone"
          className="rounded-lg border border-danger-line bg-surface px-6 py-5"
        >
          <div className="flex items-center justify-between gap-6">
            <div>
              <h2
                id="danger-zone"
                className="text-[14px] font-semibold text-danger"
              >
                Ações perigosas
              </h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Excluir remove o cliente da lista. Processos vinculados não são
                excluídos e passam a exigir revisão do vínculo.
              </p>
            </div>
            <Button
              variant="danger"
              icon={<Trash2 className="size-4" aria-hidden />}
              onClick={() => setDialog("delete")}
            >
              Excluir cliente
            </Button>
          </div>
        </section>
      </Can>

      {dialog === "inactivate" && (
        <InactivateDialog client={client} onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && (
        <DeleteDialog client={client} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
