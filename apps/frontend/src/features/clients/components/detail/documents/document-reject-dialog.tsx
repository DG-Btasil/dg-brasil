"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import type { ClientDocument } from "@/types";

/** Motivo obrigatório para rejeitar um documento. */
export function DocumentRejectDialog({
  document,
  onClose,
  onConfirm,
}: {
  document: ClientDocument | null;
  onClose: () => void;
  onConfirm: (doc: ClientDocument, reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  function close() {
    setReason("");
    setError(undefined);
    onClose();
  }

  async function confirm() {
    if (!document) return;
    if (!reason.trim()) {
      setError("Informe o motivo da rejeição.");
      return;
    }
    setSaving(true);
    await onConfirm(document, reason.trim());
    setSaving(false);
    close();
  }

  return (
    <Dialog
      open={document !== null}
      onOpenChange={(open) => !open && close()}
      size="sm"
      title="Rejeitar documento"
      description={document ? `“${document.name}” ficará marcado como rejeitado e voltará a constar como pendência.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={saving}>
            Rejeitar documento
          </Button>
        </>
      }
    >
      <Field label="Motivo" requirement="required" error={error} hint="Ex.: documento ilegível, fora da validade, de outra pessoa.">
        {(p) => <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus {...p} />}
      </Field>
    </Dialog>
  );
}
