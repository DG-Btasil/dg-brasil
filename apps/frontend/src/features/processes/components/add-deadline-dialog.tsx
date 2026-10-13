"use client";

import { useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEADLINE_TYPE_LABEL, DEADLINE_TYPES } from "@/lib/constants/status";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { useResponsibleUserOptions } from "@/features/directory/directory-context";
import { deadlineSchema, type DeadlineFormInput, type DeadlineFormValues } from "../schemas";
import { useProcessActions } from "../use-process-actions";

const typeOptions = DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABEL[t] }));
const FIELD_MAP: Record<string, keyof DeadlineFormInput> = { description: "notes", "patch.description": "notes" };

/**
 * Adicionar (ou editar, com `deadline`) prazo do processo. Vencimento é uma
 * data civil: o servidor grava 23:59:59 no horário de Brasília. "Vencido" não
 * é gravado: é derivado no banco (view deadline_status).
 */
export function AddDeadlineDialog({
  open,
  onOpenChange,
  processId,
  legalCaseId,
  defaultResponsibleId,
  deadline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  processId: string;
  legalCaseId: string;
  defaultResponsibleId?: string;
  /** Presente = edição de prazo em aberto. */
  deadline?: DeadlineDTO;
}) {
  const formId = useId();
  const { addDeadline, updateDeadline } = useProcessActions();
  const responsibleOptions = useResponsibleUserOptions();
  const defaults: DeadlineFormInput = deadline
    ? { title: deadline.title, type: deadline.type, dueDate: deadline.dueDateLocal, responsibleUserId: deadline.responsibleUserId ?? "", notes: deadline.description ?? "" }
    : { title: "", type: "MANIFESTATION", dueDate: "", responsibleUserId: defaultResponsibleId ?? "", notes: "" };
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeadlineFormInput, unknown, DeadlineFormValues>({ resolver: zodResolver(deadlineSchema), defaultValues: defaults });

  function close(next: boolean) {
    if (!next) reset(defaults);
    onOpenChange(next);
  }

  const submit = handleSubmit(async (values) => {
    if (isSubmitting) return;
    const fields = {
      title: values.title.trim(),
      type: values.type,
      dueDate: values.dueDate,
      responsibleUserId: values.responsibleUserId,
      description: values.notes?.trim() ?? "",
    };
    const result = deadline ? await updateDeadline(deadline.id, fields) : await addDeadline({ legalCaseId, processId, ...fields });
    if (result.ok) {
      close(false);
      return;
    }
    for (const [path, messages] of Object.entries(result.error.fieldErrors ?? {})) {
      const name = (FIELD_MAP[path] ?? path.replace(/^patch\./, "")) as keyof DeadlineFormInput;
      if (name in defaults) setError(name, { message: messages[0] });
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={deadline ? "Editar prazo" : "Adicionar prazo"}
      description="O prazo passa a ser acompanhado na aba Prazos e nas notificações do responsável."
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={isSubmitting}>
            {deadline ? "Salvar prazo" : "Adicionar prazo"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Field label="Título" requirement="required" className="col-span-2" error={errors.title?.message}>
          {(a) => <Input {...a} {...register("title")} maxLength={300} placeholder="Ex.: Apresentar réplica" autoFocus />}
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
        <Field label="Notas" requirement="optional" className="col-span-2" error={errors.notes?.message}>
          {(a) => <Textarea {...a} {...register("notes")} rows={3} />}
        </Field>
      </form>
    </Dialog>
  );
}
