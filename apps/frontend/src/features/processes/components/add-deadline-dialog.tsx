"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEADLINE_TYPE_LABEL, DEADLINE_TYPES } from "@/lib/constants/status";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { useResponsibleOptions } from "@/features/offices/hooks";
import { useProcessActions } from "../hooks";
import { deadlineSchema, type DeadlineFormInput, type DeadlineFormValues } from "../schemas";

const typeOptions = DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABEL[t] }));

export function AddDeadlineDialog({
  open,
  onOpenChange,
  processId,
  defaultResponsibleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processId: string;
  defaultResponsibleId: string;
}) {
  const formId = useId();
  const { addDeadline } = useProcessActions();
  const responsibleOptions = useResponsibleOptions();
  const defaults: DeadlineFormInput = { title: "", type: "MANIFESTATION", dueDate: "", responsibleUserId: defaultResponsibleId, notes: "" };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<DeadlineFormInput, unknown, DeadlineFormValues>({ resolver: zodResolver(deadlineSchema), defaultValues: defaults });

  function close(next: boolean) {
    if (!next) reset(defaults);
    onOpenChange(next);
  }

  const submit = handleSubmit(async (values) => {
    const ok = await addDeadline({
      processId,
      title: values.title,
      type: values.type,
      dueDate: values.dueDate,
      responsibleUserId: values.responsibleUserId,
      notes: values.notes?.trim() || undefined,
    });
    if (ok) close(false);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title="Adicionar prazo"
      description="O prazo passa a ser acompanhado na aba Prazos e nas notificações do responsável."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            Adicionar prazo
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="Título" requirement="required" className="col-span-2" error={errors.title?.message}>
          {(a) => <Input {...a} {...register("title")} placeholder="Ex.: Apresentar réplica" autoFocus />}
        </Field>
        <Field label="Tipo" requirement="required" error={errors.type?.message}>
          {(a) => <Select {...a} {...register("type")} options={typeOptions} />}
        </Field>
        <Field label="Vencimento" requirement="required" error={errors.dueDate?.message}>
          {(a) => <Input {...a} type="date" {...register("dueDate")} />}
        </Field>
        <Field label="Responsável" requirement="required" className="col-span-2" error={errors.responsibleUserId?.message}>
          {(a) => <Select {...a} {...register("responsibleUserId")} options={responsibleOptions} placeholder="Selecione" />}
        </Field>
        <Field label="Notas" requirement="optional" className="col-span-2">
          {(a) => <Textarea {...a} {...register("notes")} rows={3} />}
        </Field>
      </form>
    </Dialog>
  );
}
