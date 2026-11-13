"use client";

import { useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { confirmFailed } from "./confirm-result";
import { Dialog } from "./dialog";

/**
 * Confirmação de ação de um clique (encerrar, arquivar, excluir, remover).
 * O botão fica ocupado durante o envio e o diálogo não fecha no meio. Fecha
 * sozinho quando `onConfirm` termina bem; se devolver `false` ou um resultado
 * de ação com erro, continua aberto (o aviso do erro é de quem chamou).
 */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  tone = "primary",
  icon,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` para ação que tira algo da tela; `dangerSolid` para exclusão. */
  tone?: Extract<ButtonVariant, "primary" | "danger" | "dangerSolid">;
  icon?: ReactNode;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const result = await onConfirm();
    setSaving(false);
    if (!confirmFailed(result)) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {cancelLabel}
          </Button>
          <Button variant={tone} icon={icon} loading={saving} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
