"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { REVIEW_STATUS_LABEL } from "@/lib/constants/status";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import type { Review } from "@/types";
import { useReviewActions } from "../hooks";

/** Confirmação de reabertura. A decisão anterior nunca é apagada. */
export function ReopenDialog({ review, onClose }: { review: Review; onClose: () => void }) {
  const { reopen } = useReviewActions();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function confirm() {
    setSaving(true);
    const ok = await reopen(review, reason.trim() || undefined);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Reabrir revisão"
      description={
        <>
          A revisão volta para a fila como <strong>Reaberta</strong> e exigirá nova decisão. A decisão anterior ({REVIEW_STATUS_LABEL[review.status].toLowerCase()}) continua
          registrada no histórico e na auditoria. Efeitos já aplicados por ela não são desfeitos automaticamente.
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button icon={<RotateCcw className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
            Confirmar reabertura
          </Button>
        </>
      }
    >
      <Field label="Motivo" requirement="optional" hint="Ex.: aprovada por engano; erro percebido depois; precisa de ajuste no conteúdo.">
        {(a) => <Textarea {...a} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      </Field>
    </Dialog>
  );
}
