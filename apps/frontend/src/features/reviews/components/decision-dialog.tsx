"use client";

import { useId, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ReviewDecisionKind } from "@/lib/constants/status";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { approveSchema, changesSchema, rejectSchema } from "../schemas";

interface Config {
  title: string;
  fieldLabel: string;
  placeholder: string;
  confirmLabel: string;
  variant: ButtonVariant;
  required: boolean;
}

const CONFIG: Record<ReviewDecisionKind, Config> = {
  APPROVED: {
    title: "Aprovar revisão",
    fieldLabel: "Comentário",
    placeholder: "Opcional. Fica registrado no histórico e na auditoria.",
    confirmLabel: "Confirmar aprovação",
    variant: "primary",
    required: false,
  },
  CHANGES_REQUESTED: {
    title: "Solicitar alterações",
    fieldLabel: "Instruções para o agente",
    placeholder: "Descreva com objetividade o que deve ser ajustado.",
    confirmLabel: "Enviar ao agente",
    variant: "primary",
    required: true,
  },
  REJECTED: {
    title: "Rejeitar revisão",
    fieldLabel: "Motivo da rejeição",
    placeholder: "Explique por que o material não deve seguir.",
    confirmLabel: "Rejeitar",
    variant: "danger",
    required: true,
  },
};

const SCHEMA = { APPROVED: approveSchema, CHANGES_REQUESTED: changesSchema, REJECTED: rejectSchema } as const;

/** Confirmação de decisão humana. Aprovar: comentário opcional; demais: texto obrigatório. */
export function DecisionDialog({
  decision,
  description,
  onClose,
  onConfirm,
}: {
  decision: ReviewDecisionKind;
  description: ReactNode;
  onClose: () => void;
  onConfirm: (comment?: string) => Promise<boolean>;
}) {
  const formId = useId();
  const config = CONFIG[decision];
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ comment?: string }>({ resolver: zodResolver(SCHEMA[decision]), defaultValues: { comment: "" } });

  const submit = handleSubmit(async ({ comment }) => {
    const ok = await onConfirm(comment?.trim() || undefined);
    if (ok) onClose();
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={config.title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant={config.variant} loading={isSubmitting}>
            {config.confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit}>
        <Field label={config.fieldLabel} requirement={config.required ? "required" : "optional"} error={errors.comment?.message}>
          {(a) => <Textarea {...a} {...register("comment")} rows={5} placeholder={config.placeholder} autoFocus />}
        </Field>
      </form>
    </Dialog>
  );
}
