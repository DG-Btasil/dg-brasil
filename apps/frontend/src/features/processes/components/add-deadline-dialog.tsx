"use client";

import { useId } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { DEADLINE_TYPE_LABEL, DEADLINE_TYPES, HEARING_MODE_LABEL, HEARING_MODES } from "@/lib/constants/status";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { useResponsibleUserOptions } from "@/features/directory/directory-context";
import { deadlineFormFields, deadlineSchema, type DeadlineFormInput, type DeadlineFormValues } from "../schemas";
import { useProcessActions } from "../use-process-actions";
import { deadlineHasTime } from "./deadline-actions";

const typeOptions = DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABEL[t] }));
const modeOptions = HEARING_MODES.map((m) => ({ value: m, label: HEARING_MODE_LABEL[m] }));
const FIELD_MAP: Record<string, keyof DeadlineFormInput> = { description: "notes", "patch.description": "notes" };

/**
 * Adicionar (ou editar, com `deadline`) um prazo. O vencimento é uma data
 * civil: o servidor grava 23:59:59 no horário de Brasília. Quando o tipo é
 * "Audiência", o diálogo pede também a hora, a modalidade, o local e o link.
 * "Vencido" não é gravado: é derivado no banco.
 *
 * Criação usa chave de envio (clique duplo ou nova tentativa não duplicam o
 * prazo). Na edição, a data só é enviada se mudou: prazo lançado com hora
 * (por agente, por exemplo) não perde a hora ao trocar só o título.
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
  /** Criação: caso (obrigatório) e processo do prazo. Na edição vêm do próprio prazo. */
  processId?: string;
  legalCaseId?: string;
  defaultResponsibleId?: string;
  /** Presente = edição de prazo em aberto. */
  deadline?: DeadlineDTO;
}) {
  const formId = useId();
  const { addDeadline, updateDeadline } = useProcessActions();
  const idempotency = useIdempotencyKey();
  const responsibleOptions = useResponsibleUserOptions();
  // O responsável do processo vem escolhido só se ainda estiver ativo (a lista só tem pessoas ativas).
  const defaultResponsible = defaultResponsibleId && responsibleOptions.some((o) => o.value === defaultResponsibleId) ? defaultResponsibleId : "";
  const defaults: DeadlineFormInput = deadline
    ? {
        title: deadline.title,
        type: deadline.type,
        dueDate: deadline.dueDateLocal,
        dueTime: deadline.type === "HEARING" && deadlineHasTime(deadline) ? deadline.dueTimeLocal : "",
        responsibleUserId: deadline.responsibleUserId ?? "",
        hearingMode: deadline.hearingMode ?? "",
        hearingLocation: deadline.hearingLocation ?? "",
        hearingLink: deadline.hearingLink ?? "",
        notes: deadline.description ?? "",
      }
    : { title: "", type: "MANIFESTATION", dueDate: "", dueTime: "", responsibleUserId: defaultResponsible, hearingMode: "", hearingLocation: "", hearingLink: "", notes: "" };
  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors, isSubmitting },
  } = useForm<DeadlineFormInput, unknown, DeadlineFormValues>({ resolver: zodResolver(deadlineSchema), defaultValues: defaults });
  const isHearing = useWatch({ control, name: "type" }) === "HEARING";

  function close(next: boolean) {
    if (!next) reset(defaults);
    onOpenChange(next);
  }

  const submit = handleSubmit(async (values) => {
    if (isSubmitting) return;
    const fields = deadlineFormFields(values);
    let result;
    if (deadline) {
      // Data e hora só vão no pedido quando mudaram (ou quando o tipo mudou e a regra da hora é outra).
      const dueChanged = values.dueDate !== defaults.dueDate || (values.dueTime ?? "") !== (defaults.dueTime ?? "") || values.type !== defaults.type;
      const { dueDate, dueTime, ...rest } = fields;
      result = await updateDeadline(deadline.id, dueChanged ? { ...rest, dueDate, dueTime } : rest);
    } else {
      if (!legalCaseId) return;
      const payload = { legalCaseId, processId, ...fields };
      result = await addDeadline({ ...payload, idempotencyKey: idempotency.keyFor(payload) });
    }
    if (result.ok) {
      idempotency.reset();
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
      description="O prazo aparece na aba Prazos do processo e na agenda do escritório, e gera lembretes para o responsável."
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
        <Field label="Tipo" requirement="required" className={isHearing ? "col-span-2" : undefined} error={errors.type?.message}>
          {(a) => <Select {...a} {...register("type")} options={typeOptions} />}
        </Field>
        <Field label={isHearing ? "Data da audiência" : "Data do prazo"} requirement="required" error={errors.dueDate?.message}>
          {(a) => <Input {...a} type="date" {...register("dueDate")} />}
        </Field>
        {isHearing && (
          <>
            <Field label="Hora" requirement="required" hint="Horário de Brasília." error={errors.dueTime?.message}>
              {(a) => <Input {...a} type="time" {...register("dueTime")} />}
            </Field>
            <Field label="Modalidade" requirement="required" error={errors.hearingMode?.message}>
              {(a) => <Select {...a} {...register("hearingMode")} options={modeOptions} placeholder="Selecione" />}
            </Field>
            <Field label="Local" requirement="optional" hint="Fórum, vara e sala." error={errors.hearingLocation?.message}>
              {(a) => <Input {...a} {...register("hearingLocation")} maxLength={500} placeholder="Ex.: Fórum Central, 3ª Vara Cível, sala 12" />}
            </Field>
            <Field label="Link da sala" requirement="optional" className="col-span-2" hint="Para audiência por videoconferência." error={errors.hearingLink?.message}>
              {(a) => <Input {...a} type="url" {...register("hearingLink")} maxLength={1000} placeholder="https://" />}
            </Field>
          </>
        )}
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
