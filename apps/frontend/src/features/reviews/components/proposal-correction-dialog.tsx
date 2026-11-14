"use client";

import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import {
  CLIENT_POLE_LABEL,
  CLIENT_POLES,
  DEADLINE_TYPE_LABEL,
  DEADLINE_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  LEGAL_CASE_STATUS_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
} from "@/lib/constants/status";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { NOTHING_CHANGED_MESSAGE, type CorrectableProposalType } from "@/server/domain/reviews/correction-rules";
import { useDirectoryUserMap, useResponsibleUserOptions } from "@/features/directory/directory-context";
import {
  AGENT_CASE_STATUSES,
  caseCorrectionData,
  caseCorrectionDefaults,
  caseCorrectionSchema,
  CORRECTION_TITLE,
  correctionRows,
  deadlineCorrectionData,
  deadlineCorrectionDefaults,
  deadlineCorrectionSchema,
  documentCorrectionData,
  documentCorrectionDefaults,
  documentCorrectionSchema,
  processCorrectionData,
  processCorrectionDefaults,
  processCorrectionSchema,
  type CaseCorrectionInput,
  type CaseCorrectionValues,
  type DeadlineCorrectionInput,
  type DeadlineCorrectionValues,
  type DocumentCorrectionInput,
  type DocumentCorrectionValues,
  type ProcessCorrectionInput,
  type ProcessCorrectionValues,
} from "../proposal-correction";
import { useReviewActions } from "../use-review-actions";

type Data = Record<string, unknown>;

const typeOptions = DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_TYPE_LABEL[t] }));
const priorityOptions = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));
const categoryOptions = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABEL[c] }));
const caseStatusOptions = AGENT_CASE_STATUSES.map((s) => ({ value: s, label: LEGAL_CASE_STATUS_LABEL[s] }));
const poleOptions = CLIENT_POLES.map((p) => ({ value: p, label: CLIENT_POLE_LABEL[p] }));

interface FormProps {
  formId: string;
  original: Data;
  hidden: boolean;
  onValid: (data: Data) => void;
}

/**
 * "Corrigir e aprovar" (069). Etapa 1: o formulário do tipo da proposta, já
 * preenchido com o que o agente propôs (o prazo usa o mesmo formulário e as
 * mesmas regras do diálogo de prazo da equipe). Etapa 2: o resumo do que vai
 * ser aplicado (antes → depois) e a confirmação. Confirmar corrige e aprova
 * numa decisão só, no servidor; nada muda na tela antes da resposta.
 */
export function ProposalCorrectionDialog({
  reviewId,
  proposalType,
  original,
  subject,
  onClose,
}: {
  reviewId: string;
  proposalType: CorrectableProposalType;
  /** Os dados que o agente propôs (payload.data). */
  original: Data;
  subject: string;
  onClose: () => void;
}) {
  const formId = useId();
  const users = useDirectoryUserMap();
  const actions = useReviewActions();
  const [corrected, setCorrected] = useState<Data | null>(null);
  const [nothing, setNothing] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const userName = (id: string) => users.get(id)?.name;
  const rows = corrected ? correctionRows(original, corrected, userName) : [];

  const onValid = (data: Data) => {
    const changes = correctionRows(original, data, userName);
    setNothing(changes.length === 0);
    if (changes.length > 0) setCorrected(data);
  };

  const form = { formId, original, hidden: corrected !== null, onValid };
  const confirm = async () => {
    if (!corrected) return;
    setSaving(true);
    const ok = await actions.correctAndApprove(reviewId, corrected, notes.trim() || undefined);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && !saving && onClose()}
      title={corrected ? "Conferir a correção e aprovar" : CORRECTION_TITLE[proposalType]}
      description={
        corrected
          ? "Confira o que muda em relação à proposta do agente. Ao confirmar, a proposta corrigida é aprovada e aplicada automaticamente, em até um minuto."
          : `${subject}. Ajuste o que o agente propôs. Na próxima etapa você confere o resumo antes de aprovar.`
      }
      footer={
        corrected ? (
          <>
            <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => setCorrected(null)} disabled={saving}>
              Voltar e editar
            </Button>
            <Button icon={<CheckCircle2 className="size-4" aria-hidden />} loading={saving} onClick={confirm}>
              Confirmar correção e aprovar
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form={formId}>
              Conferir a correção
            </Button>
          </>
        )
      }
    >
      {nothing && !corrected && (
        <Callout tone="warning" className="mb-4">
          {NOTHING_CHANGED_MESSAGE}
        </Callout>
      )}
      {proposalType === "CREATE_DEADLINE" && <DeadlineForm {...form} />}
      {proposalType === "REQUEST_DOCUMENT" && <DocumentForm {...form} />}
      {proposalType === "UPDATE_CASE" && <CaseForm {...form} />}
      {proposalType === "CREATE_PROCESS" && <ProcessForm {...form} />}
      {corrected && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-md border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-muted text-left text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Campo</th>
                  <th className="px-3 py-2 font-medium">Proposta do agente</th>
                  <th className="px-3 py-2 font-medium">Vai ser aplicado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-muted line-through decoration-muted/60 whitespace-pre-wrap break-words">{r.before}</td>
                    <td className="px-3 py-2 whitespace-pre-wrap break-words">{r.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted">Os outros campos ficam como o agente propôs. A proposta original fica guardada no histórico da revisão.</p>
          <Field label="Comentário" requirement="optional">
            {(a) => (
              <Textarea {...a} rows={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional. Fica registrado no histórico e na auditoria." />
            )}
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

function DeadlineForm({ formId, original, hidden, onValid }: FormProps) {
  const responsibleOptions = useResponsibleUserOptions();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<DeadlineCorrectionInput, unknown, DeadlineCorrectionValues>({ resolver: zodResolver(deadlineCorrectionSchema), defaultValues: deadlineCorrectionDefaults(original) });
  const isHearing = useWatch({ control, name: "type" }) === "HEARING";
  return (
    <form id={formId} noValidate hidden={hidden} onSubmit={handleSubmit((v) => onValid(deadlineCorrectionData(original, v)))} className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Field label="Título" requirement="required" className="col-span-2" error={errors.title?.message}>
        {(a) => <Input {...a} {...register("title")} maxLength={200} autoFocus />}
      </Field>
      <Field label="Tipo" requirement="required" className={isHearing ? "col-span-2" : undefined} error={errors.type?.message}>
        {(a) => <Select {...a} {...register("type")} options={typeOptions} />}
      </Field>
      <Field label={isHearing ? "Data da audiência" : "Data do prazo"} requirement="required" hint={isHearing ? undefined : "Vale até 23:59 de Brasília."} error={errors.dueDate?.message}>
        {(a) => <Input {...a} type="date" {...register("dueDate")} />}
      </Field>
      {isHearing && (
        <Field label="Hora" requirement="required" hint="Horário de Brasília. Modalidade, local e link: complete no prazo depois de aprovado." error={errors.dueTime?.message}>
          {(a) => <Input {...a} type="time" {...register("dueTime")} />}
        </Field>
      )}
      <Field label="Responsável" requirement="required" error={errors.responsibleUserId?.message}>
        {(a) => <Select {...a} {...register("responsibleUserId")} options={responsibleOptions} placeholder="Selecione" />}
      </Field>
      <Field label="Prioridade" requirement="required" error={errors.priority?.message}>
        {(a) => <Select {...a} {...register("priority")} options={priorityOptions} />}
      </Field>
      <Field label="Descrição" requirement="optional" className="col-span-2" hint="Fundamento e contagem do prazo." error={errors.notes?.message}>
        {(a) => <Textarea {...a} {...register("notes")} rows={4} maxLength={4000} />}
      </Field>
    </form>
  );
}

function DocumentForm({ formId, original, hidden, onValid }: FormProps) {
  const defaults = documentCorrectionDefaults(original);
  // Categoria fora da lista (código livre do agente) continua escolhível.
  const options = categoryOptions.some((o) => o.value === defaults.category) ? categoryOptions : [...categoryOptions, { value: defaults.category, label: defaults.category }];
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DocumentCorrectionInput, unknown, DocumentCorrectionValues>({ resolver: zodResolver(documentCorrectionSchema), defaultValues: defaults });
  return (
    <form id={formId} noValidate hidden={hidden} onSubmit={handleSubmit((v) => onValid(documentCorrectionData(original, v)))} className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Field label="Documento pedido" requirement="required" className="col-span-2" error={errors.label?.message}>
        {(a) => <Input {...a} {...register("label")} maxLength={200} autoFocus />}
      </Field>
      <Field label="Categoria" requirement="required" error={errors.category?.message}>
        {(a) => <Select {...a} {...register("category")} options={options} />}
      </Field>
      <Field label="Obrigatório" requirement="required" error={errors.required?.message}>
        {(a) => (
          <Select
            {...a}
            {...register("required")}
            options={[
              { value: "yes", label: "Sim" },
              { value: "no", label: "Não" },
            ]}
          />
        )}
      </Field>
      <Field label="Prazo para o parceiro" requirement="optional" hint="Só vale quando o caso é de parceiro." error={errors.dueDate?.message}>
        {(a) => <Input {...a} type="date" {...register("dueDate")} />}
      </Field>
      <Field label="Mensagem ao parceiro" requirement="optional" className="col-span-2" hint="Se preenchida e o caso for de parceiro, ele recebe este texto como solicitação." error={errors.messageToPartner?.message}>
        {(a) => <Textarea {...a} {...register("messageToPartner")} rows={4} maxLength={2000} />}
      </Field>
    </form>
  );
}

function CaseForm({ formId, original, hidden, onValid }: FormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CaseCorrectionInput, unknown, CaseCorrectionValues>({ resolver: zodResolver(caseCorrectionSchema), defaultValues: caseCorrectionDefaults(original) });
  return (
    <form id={formId} noValidate hidden={hidden} onSubmit={handleSubmit((v) => onValid(caseCorrectionData(original, v)))} className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Field label="Título do caso" requirement="optional" className="col-span-2" hint="Em branco: o título não muda." error={errors.title?.message}>
        {(a) => <Input {...a} {...register("title")} maxLength={200} autoFocus />}
      </Field>
      <Field label="Situação" requirement="optional" className="col-span-2" hint="Em branco: a situação não muda." error={errors.status?.message}>
        {(a) => <Select {...a} {...register("status")} options={caseStatusOptions} placeholder="Não mudar" />}
      </Field>
      <Field label="Resumo do caso" requirement="optional" className="col-span-2" hint="Em branco: o resumo não muda." error={errors.summary?.message}>
        {(a) => <Textarea {...a} {...register("summary")} rows={6} maxLength={8000} />}
      </Field>
    </form>
  );
}

function ProcessForm({ formId, original, hidden, onValid }: FormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProcessCorrectionInput, unknown, ProcessCorrectionValues>({ resolver: zodResolver(processCorrectionSchema), defaultValues: processCorrectionDefaults(original) });
  return (
    <form id={formId} noValidate hidden={hidden} onSubmit={handleSubmit((v) => onValid(processCorrectionData(original, v)))} className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Field label="Número CNJ" requirement="optional" className="col-span-2" hint="Os 20 dígitos. Em branco: processo sem número ainda." error={errors.cnj?.message}>
        {(a) => <Input {...a} {...register("cnj")} maxLength={25} placeholder="0000000-00.0000.0.00.0000" autoFocus />}
      </Field>
      <Field label="Tribunal" requirement="optional" error={errors.court?.message}>
        {(a) => <Input {...a} {...register("court")} maxLength={200} />}
      </Field>
      <Field label="Vara" requirement="optional" error={errors.courtUnit?.message}>
        {(a) => <Input {...a} {...register("courtUnit")} maxLength={200} />}
      </Field>
      <Field label="Comarca" requirement="optional" error={errors.district?.message}>
        {(a) => <Input {...a} {...register("district")} maxLength={200} />}
      </Field>
      <Field label="UF" requirement="optional" error={errors.state?.message}>
        {(a) => <Input {...a} {...register("state")} maxLength={2} />}
      </Field>
      <Field label="Classe" requirement="optional" error={errors.legalClass?.message}>
        {(a) => <Input {...a} {...register("legalClass")} maxLength={200} />}
      </Field>
      <Field label="Polo do cliente" requirement="optional" error={errors.clientSide?.message}>
        {(a) => <Select {...a} {...register("clientSide")} options={poleOptions} placeholder="Não informado" />}
      </Field>
      <Field label="Assunto" requirement="optional" className="col-span-2" error={errors.subject?.message}>
        {(a) => <Input {...a} {...register("subject")} maxLength={500} />}
      </Field>
      <Field label="Parte contrária" requirement="optional" className="col-span-2" error={errors.adverseParty?.message}>
        {(a) => <Input {...a} {...register("adverseParty")} maxLength={2000} />}
      </Field>
      <Field label="Valor da causa" requirement="optional" hint="Ex.: 15.000,00" error={errors.caseValue?.message}>
        {(a) => <Input {...a} {...register("caseValue")} inputMode="decimal" />}
      </Field>
    </form>
  );
}
