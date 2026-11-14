"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RefreshCcw } from "lucide-react";
import { z } from "zod";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { officeQueueNotice, REDO_MESSAGE_MAX, REDO_MESSAGE_MIN, redoRoundLabel, type OfficeState } from "@/server/domain/reviews/redo-rules";
import { useReviewActions } from "../use-review-actions";

const schema = z.object({
  message: z
    .string()
    .trim()
    .min(REDO_MESSAGE_MIN, `Escreva o que precisa mudar (no mínimo ${REDO_MESSAGE_MIN} caracteres).`)
    .max(REDO_MESSAGE_MAX, `Máximo de ${REDO_MESSAGE_MAX} caracteres.`),
});
type Values = z.infer<typeof schema>;

/**
 * "Pedir para o agente refazer" (070). A pessoa escreve o que está errado; o
 * servidor encerra esta revisão (rejeitada, com o recado) e manda um trabalho
 * novo ao mesmo agente, com o pedido original, o que ele entregou e o recado.
 * Nada é aplicado: o que o agente refizer volta para Revisões.
 */
export function RedoDialog({
  reviewId,
  subject,
  agentName,
  round,
  office,
  onClose,
}: {
  reviewId: string;
  subject: string;
  agentName?: string;
  /** Refazeres que já levaram até este trabalho (0 = trabalho original). */
  round: number;
  office?: OfficeState;
  onClose: () => void;
}) {
  const formId = useId();
  const actions = useReviewActions();
  const notice = officeQueueNotice(office);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { message: "" } });

  const submit = handleSubmit(async ({ message }) => {
    const ok = await actions.redo(reviewId, message.trim(), notice?.short);
    if (ok) onClose();
  });

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && !isSubmitting && onClose()}
      title="Pedir para o agente refazer"
      description={`${subject}. ${agentName ? `${agentName} recebe` : "O agente recebe"} um trabalho novo com o pedido original, o que entregou e o seu recado. ${redoRoundLabel(round + 1)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} icon={<RefreshCcw className="size-4" aria-hidden />} loading={isSubmitting}>
            Pedir para refazer
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <Callout tone="info" title="O que acontece">
          Esta revisão é encerrada como rejeitada, com o seu recado, e nada é aplicado. O agente refaz o trabalho e o resultado volta para Revisões, para você decidir de novo.
        </Callout>
        {notice && (
          <Callout tone="warning" title={notice.title}>
            {notice.message}
          </Callout>
        )}
        <Field label="O que precisa mudar" requirement="required" hint="Seja específico: o agente corrige a partir do que entregou, não começa do zero." error={errors.message?.message}>
          {(a) => <Textarea {...a} {...register("message")} rows={6} maxLength={REDO_MESSAGE_MAX} placeholder="Ex.: a data está errada; a intimação saiu na sexta, conte a partir de segunda." autoFocus />}
        </Field>
      </form>
    </Dialog>
  );
}
