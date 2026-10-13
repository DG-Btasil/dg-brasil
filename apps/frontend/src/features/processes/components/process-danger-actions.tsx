"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { pluralize } from "@/lib/formatting";
import type { ProcessInternalDTO } from "@/server/domain/processes/dto";
import { useProcessActions } from "../use-process-actions";

/** Menu secundário do processo. A exclusão fica aqui, nunca como CTA principal. */
export function ProcessActionsMenu({ processId, onDelete }: { processId: string; onDelete: () => void }) {
  // Exclusão é restrita a quem tem "processes.delete" (somente Administrador; o banco confere).
  const canDelete = usePermission("processes.delete");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const item = "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors";
  return (
    <div ref={ref} className="relative">
      <IconButton variant="secondary" label="Mais ações do processo" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal className="size-4" aria-hidden />
      </IconButton>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1 w-[220px] overflow-hidden rounded-md border border-line bg-surface py-1 shadow-overlay">
          <Link role="menuitem" href={`/processos/${processId}/editar`} className={`${item} text-foreground hover:bg-surface-muted`} onClick={() => setOpen(false)}>
            <Pencil className="size-4 text-muted" aria-hidden />
            Editar dados do processo
          </Link>
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

/** Confirmação de exclusão (lógica, auditada). O caso e o cliente nunca são excluídos. */
export function DeleteProcessDialog({ process, openDeadlines, onClose }: { process: ProcessInternalDTO; openDeadlines: number; onClose: () => void }) {
  const router = useRouter();
  const { removeProcess } = useProcessActions();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const result = await removeProcess(process.id);
    setSaving(false);
    if (result.ok) router.push(`/casos/${process.legalCaseId}?aba=processos`);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      title="Excluir processo"
      description={`Tem certeza de que deseja excluir “${process.title}”?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="danger" className="border-danger bg-danger text-white hover:bg-danger/90" icon={<Trash2 className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
            Excluir processo
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        {openDeadlines > 0 ? (
          <Callout tone="warning" title={`Este processo possui ${pluralize(openDeadlines, "prazo em aberto", "prazos em aberto")}.`}>
            Depois da exclusão, os prazos deixam de aparecer nas listagens. Confira antes de confirmar. A exclusão fica registrada na auditoria.
          </Callout>
        ) : (
          <Callout tone="neutral">A exclusão fica registrada na auditoria. Movimentações e documentos continuam no histórico.</Callout>
        )}
        <p className="text-muted">
          O caso <strong className="text-foreground">{process.caseTitle || "vinculado"}</strong> e o cliente{" "}
          <strong className="text-foreground">{process.clientName || "do caso"}</strong> não serão excluídos.
        </p>
      </div>
    </Dialog>
  );
}
