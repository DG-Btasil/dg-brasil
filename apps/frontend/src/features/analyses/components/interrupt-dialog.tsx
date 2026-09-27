"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";

export function InterruptDialog({ analysisId, open, onOpenChange }: { analysisId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  function close() {
    setReason("");
    setError(undefined);
    onOpenChange(false);
  }

  async function confirm() {
    if (!reason.trim()) {
      setError("Informe o motivo da interrupção.");
      return;
    }
    setSaving(true);
    await repositories.analyses.interrupt(analysisId, reason.trim());
    setSaving(false);
    toast({ tone: "info", title: "Análise interrompida", description: "Ela pode ser retomada a qualquer momento." });
    close();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      size="sm"
      title="Interromper análise"
      description="A análise fica pausada com o motivo registrado no histórico. Nenhum dado é perdido."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={saving}>
            Interromper análise
          </Button>
        </>
      }
    >
      <Field label="Motivo" requirement="required" error={error} hint="Ex.: cliente pediu para aguardar, caso em negociação.">
        {(p) => <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus {...p} />}
      </Field>
    </Dialog>
  );
}
