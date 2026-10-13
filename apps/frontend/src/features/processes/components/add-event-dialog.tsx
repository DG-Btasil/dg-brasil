"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { processEventSchema, type ProcessEventValues } from "../schemas";
import { useProcessActions } from "../use-process-actions";

const DEFAULTS: ProcessEventValues = { title: "", description: "", important: false };

/**
 * "Registrar andamento": nota da EQUIPE (origem MANUAL, gravada pelo
 * servidor). Movimentação oficial do tribunal só entra pela integração —
 * aqui não há como escolher outra origem.
 */
export function AddEventDialog({ open, onOpenChange, processId }: { open: boolean; onOpenChange: (open: boolean) => void; processId: string }) {
  const formId = useId();
  const { addEvent } = useProcessActions();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProcessEventValues>({ resolver: zodResolver(processEventSchema), defaultValues: DEFAULTS });

  function close(next: boolean) {
    if (!next) reset(DEFAULTS);
    onOpenChange(next);
  }

  const submit = handleSubmit(async (values) => {
    if (isSubmitting) return;
    const result = await addEvent(processId, { title: values.title.trim(), description: values.description?.trim() ?? "", important: values.important });
    if (result.ok) close(false);
    else if (result.error.fieldErrors?.title) setError("title", { message: result.error.fieldErrors.title[0] });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Registrar andamento"
      description="O andamento entra na linha do tempo do processo com origem “Equipe”."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Registrar
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="space-y-4">
        <Field label="Título" requirement="required" error={errors.title?.message}>
          {(a) => <Input {...a} {...register("title")} maxLength={300} placeholder="Ex.: Juntada de contestação" autoFocus />}
        </Field>
        <Field label="Descrição" requirement="optional">
          {(a) => <Textarea {...a} {...register("description")} rows={4} />}
        </Field>
        <Checkbox {...register("important")} label="Andamento relevante" description="Aparece destacado na linha do tempo." />
      </form>
    </Dialog>
  );
}
