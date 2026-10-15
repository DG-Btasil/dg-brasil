"use client";

import { useState } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AgentRunCancelDTO } from "@/server/domain/agents/dto";
import { useToast } from "@/store/ui-store";
import { interruptOutcomeMessage } from "../interrupt";

/**
 * Confirmação de "Interromper" (033). O servidor decide e responde; a tela só
 * muda depois da resposta (sem estado final otimista): na fila, a execução
 * para já; rodando, o pedido fica registrado até o worker confirmar.
 */
export function InterruptDialog({
  subject,
  run,
  onDone,
  onClose,
}: {
  /** "esta análise" / "esta execução". */
  subject: string;
  run: () => Promise<ActionResult<AgentRunCancelDTO>>;
  onDone: (result: AgentRunCancelDTO) => void;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const failed = useActionFeedback();

  async function confirm() {
    if (saving) return;
    setSaving(true);
    const r = await callAction(run);
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível interromper.");
      return;
    }
    toast({ tone: r.data.outcome === "CANCEL_REQUESTED" ? "info" : "success", ...interruptOutcomeMessage(r.data.outcome) });
    onDone(r.data);
    onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      size="sm"
      title={`Interromper ${subject}?`}
      description="Na fila, ela não será processada. Em execução, o agente é avisado e para; o que ele já tiver entregue continua em Revisões para decisão humana. Não dá para desfazer — depois é possível enviar de novo."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Voltar
          </Button>
          <Button variant="danger" loading={saving} onClick={confirm}>
            Interromper
          </Button>
        </>
      }
    />
  );
}
