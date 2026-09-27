"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { useProcessActions } from "../hooks";
import { processEventSchema, type ProcessEventValues } from "../schemas";

const DEFAULTS: ProcessEventValues = { title: "", description: "", important: false };

/** "Registrar andamento": movimentação lançada pela equipe. */
export function AddEventDialog({ open, onOpenChange, processId }: { open: boolean; onOpenChange: (open: boolean) => void; processId: string }) {
  const formId = useId();
  const { addEvent } = useProcessActions();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProcessEventValues>({ resolver: zodResolver(processEventSchema), defaultValues: DEFAULTS });

  function close(next: boolean) {
    if (!next) reset(DEFAULTS);
    onOpenChange(next);
  }

  const submit = handleSubmit(async (values) => {
    const ok = await addEvent(processId, {
      title: values.title,
      description: values.description?.trim() || undefined,
      important: values.important,
    });
    if (ok) close(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Registrar andamento"
      description="O andamento entra na linha do tempo do processo com origem “Equipe”."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
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
          {(a) => <Input {...a} {...register("title")} placeholder="Ex.: Juntada de contestação" autoFocus />}
        </Field>
        <Field label="Descrição" requirement="optional">
          {(a) => <Textarea {...a} {...register("description")} rows={4} />}
        </Field>
        <Checkbox {...register("important")} label="Andamento relevante" description="Aparece destacado na linha do tempo." />
      </form>
    </Dialog>
  );
}
