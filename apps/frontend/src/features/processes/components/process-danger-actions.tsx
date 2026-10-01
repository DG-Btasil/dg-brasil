"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, MoreHorizontal, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/form";
import { Callout } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { pluralize } from "@/lib/formatting";
import type { Process } from "@/types";
import {
  useClients,
  useProcessActions,
  useProcessDeletionImpact,
} from "../hooks";
import { clientDisplayName } from "../utils";

/** Menu secundário do processo. A exclusão fica aqui, nunca como CTA principal. */
export function ProcessActionsMenu({
  onDelete,
  onLinkClient,
}: {
  onDelete: () => void;
  onLinkClient: () => void;
}) {
  // Exclusão é restrita a quem tem "processes.delete" (somente Administrador).
  const canDelete = usePermission("processes.delete");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const item =
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors";
  return (
    <div ref={ref} className="relative">
      <IconButton
        variant="secondary"
        label="Mais ações do processo"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </IconButton>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-[220px] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-overlay"
        >
          <button
            type="button"
            role="menuitem"
            className={`${item} text-foreground hover:bg-surface-muted`}
            onClick={() => {
              setOpen(false);
              onLinkClient();
            }}
          >
            <Link2 className="size-4 text-muted" aria-hidden />
            Alterar cliente vinculado
          </button>
          {canDelete && (
            <>
              <div className="my-1 h-px bg-line" aria-hidden />
              <button
                type="button"
                role="menuitem"
                className={`${item} text-danger hover:bg-danger-soft`}
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                Excluir processo
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Confirmação de exclusão, com aviso do que está associado. O cliente nunca é excluído. */
export function DeleteProcessDialog({
  process,
  clientName,
  onClose,
}: {
  process: Process;
  clientName: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const impact = useProcessDeletionImpact(process.id);
  const { deleteProcess } = useProcessActions();
  const [saving, setSaving] = useState(false);

  const warnings = [
    impact.reviews > 0 &&
      `${pluralize(impact.reviews, "revisão", "revisões")} (mantidas no histórico)`,
    impact.openDeadlines > 0 &&
      `${pluralize(impact.openDeadlines, "prazo em aberto", "prazos em aberto")} (serão removidos)`,
    impact.documents > 0 &&
      `${pluralize(impact.documents, "documento vinculado", "documentos vinculados")} (continuam no cliente)`,
  ].filter(Boolean) as string[];

  async function confirm() {
    setSaving(true);
    const ok = await deleteProcess(process);
    setSaving(false);
    if (ok) router.push("/processos");
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Excluir processo"
      description={`Tem certeza de que deseja excluir “${process.title}”?`}
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
            onClick={confirm}
          >
            Excluir processo
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {warnings.length > 0 ? (
          <Callout
            tone="warning"
            title={`Este processo possui ${warnings.join(", ")}.`}
          >
            Confira antes de confirmar. A exclusão fica registrada na auditoria.
          </Callout>
        ) : (
          <Callout tone="neutral">
            Nenhuma revisão, prazo em aberto, documento ou registro financeiro
            está associado.
          </Callout>
        )}
        <p className="text-muted">
          O cliente <strong className="text-foreground">{clientName}</strong>{" "}
          não será excluído e continua normalmente no sistema.
        </p>
      </div>
    </Dialog>
  );
}

/** Vincular (ou trocar) o cliente do processo. Resolve o vínculo pendente. */
export function LinkClientDialog({
  process,
  onClose,
}: {
  process: Process;
  onClose: () => void;
}) {
  const clients = useClients();
  const { linkClient } = useProcessActions();
  const [clientId, setClientId] = useState(
    process.clientLinkStatus === "PENDING_LINK" ? "" : process.clientId,
  );
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const options = clients
    .map((c) => ({ value: c.id, label: clientDisplayName(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  async function confirm() {
    if (!clientId) return setError("Selecione o cliente.");
    setSaving(true);
    const ok = await linkClient(process.id, clientId);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Vincular cliente ao processo"
      description="Cliente e processo têm ciclos de vida independentes. O vínculo fica registrado nas movimentações e na auditoria."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            icon={<Link2 className="size-4" aria-hidden />}
            loading={saving}
            onClick={confirm}
          >
            Vincular cliente
          </Button>
        </>
      }
    >
      <Field label="Cliente" requirement="required" error={error}>
        {(a) => (
          <Select
            {...a}
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setError(undefined);
            }}
            options={options}
            placeholder="Selecione o cliente"
          />
        )}
      </Field>
    </Dialog>
  );
}
