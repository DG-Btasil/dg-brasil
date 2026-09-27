"use client";

import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CLIENT_POLE_LABEL, CLIENT_POLES, DEADLINE_TYPE_LABEL, DEADLINE_TYPES, PROCESS_PHASE_LABEL, PROCESS_PHASES, PROCESS_STATUS_LABEL, PROCESS_STATUSES } from "@/lib/constants/status";
import { BRAZILIAN_STATES, COURTS, LEGAL_AREA_LABEL, LEGAL_AREAS } from "@/lib/constants/legal";
import { onlyDigits } from "@/lib/formatting";
import { parseCurrencyInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { useClients, useLawyerOptions, type NewProcessInput } from "../hooks";
import { processFormSchema, type ProcessFormInput, type ProcessFormValues } from "../schemas";
import { clientDisplayName } from "../utils";

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));
const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function toInput(v: ProcessFormValues): NewProcessInput {
  return {
    clientId: v.clientId,
    cnj: blank(v.cnj),
    title: v.title,
    court: blank(v.court),
    unit: blank(v.unit),
    district: blank(v.district),
    state: blank(v.state),
    area: v.area,
    actionType: v.actionType,
    subject: blank(v.subject),
    clientPole: v.clientPole,
    opposingParty: blank(v.opposingParty),
    responsibleUserId: v.responsibleUserId,
    distributionDate: blank(v.distributionDate),
    caseValue: parseCurrencyInput(v.caseValue),
    status: v.status,
    phase: v.phase,
    notes: blank(v.notes),
    nextDeadline:
      v.deadlineTitle && v.deadlineType && v.deadlineDueDate
        ? { title: v.deadlineTitle.trim(), type: v.deadlineType, dueDate: v.deadlineDueDate }
        : undefined,
  };
}

export function ProcessForm({
  initialClientId,
  onSubmit,
  onCancel,
}: {
  initialClientId: string;
  onSubmit: (input: NewProcessInput) => Promise<void>;
  onCancel: () => void;
}) {
  const clients = useClients();
  const lawyers = useLawyerOptions();
  const clientOptions = useMemo(
    () => clients.map((c) => ({ value: c.id, label: clientDisplayName(c) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [clients],
  );
  const initialResponsible = clients.find((c) => c.id === initialClientId)?.responsibleUserId;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProcessFormInput, unknown, ProcessFormValues>({
    resolver: zodResolver(processFormSchema),
    defaultValues: {
      clientId: initialClientId,
      responsibleUserId: lawyers.some((l) => l.value === initialResponsible) ? initialResponsible : "",
      status: "PRE_FILING",
      phase: "PRELIMINARY",
      clientPole: "ACTIVE",
    },
    shouldFocusError: true,
  });

  // Status padrão acompanha o CNJ enquanto o usuário não escolhe outro.
  const cnjField = register("cnj", {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (dirtyFields.status) return;
      const hasCnj = onlyDigits(e.target.value).length > 0;
      setValue("status", hasCnj ? "ACTIVE" : "PRE_FILING");
      setValue("phase", hasCnj ? "PLEADINGS" : "PRELIMINARY");
    },
  });

  return (
    <form noValidate onSubmit={handleSubmit((values) => onSubmit(toInput(values)))}>
      <Panel className="px-7">
        <FormSection title="Cliente e identificação" description="Todo processo pertence a um cliente. O número CNJ pode ficar em branco em casos pré-ajuizamento.">
          <Field label="Cliente" requirement="required" error={errors.clientId?.message}>
            {(a) => <Select {...a} {...register("clientId")} options={clientOptions} placeholder="Selecione o cliente" />}
          </Field>
          <Field label="Número CNJ" requirement="optional" hint="Formato 0000000-00.0000.0.00.0000" error={errors.cnj?.message}>
            {(a) => <MaskedInput {...a} {...cnjField} mask="cnj" placeholder="0000000-00.0000.0.00.0000" />}
          </Field>
          <Field label="Nome resumido" requirement="required" className="col-span-2" hint="Como a equipe se refere ao caso, ex.: “Revisional de consignados”." error={errors.title?.message}>
            {(a) => <Input {...a} {...register("title")} />}
          </Field>
        </FormSection>

        <FormSection title="Juízo" description="Onde o processo tramita ou tramitará.">
          <Field label="Tribunal" requirement="optional">
            {(a) => <Select {...a} {...register("court")} options={opts(COURTS)} placeholder="Selecione" />}
          </Field>
          <Field label="Unidade / vara" requirement="optional">
            {(a) => <Input {...a} {...register("unit")} placeholder="Ex.: 2ª Vara Cível" />}
          </Field>
          <Field label="Comarca" requirement="optional">
            {(a) => <Input {...a} {...register("district")} />}
          </Field>
          <Field label="UF" requirement="optional">
            {(a) => <Select {...a} {...register("state")} options={opts(BRAZILIAN_STATES)} placeholder="Selecione" />}
          </Field>
        </FormSection>

        <FormSection title="Objeto e partes" description="Classificação jurídica e posição do cliente na demanda.">
          <Field label="Área jurídica" requirement="required" error={errors.area?.message}>
            {(a) => <Select {...a} {...register("area")} options={opts(LEGAL_AREAS, LEGAL_AREA_LABEL)} placeholder="Selecione" />}
          </Field>
          <Field label="Tipo de ação" requirement="required" error={errors.actionType?.message}>
            {(a) => <Input {...a} {...register("actionType")} placeholder="Ex.: Ação revisional de contrato bancário" />}
          </Field>
          <Field label="Assunto" requirement="optional">
            {(a) => <Input {...a} {...register("subject")} />}
          </Field>
          <Field label="Polo do cliente" requirement="required" error={errors.clientPole?.message}>
            {(a) => <Select {...a} {...register("clientPole")} options={opts(CLIENT_POLES, CLIENT_POLE_LABEL)} />}
          </Field>
          <Field label="Parte contrária" requirement="recommended" className="col-span-2">
            {(a) => <Input {...a} {...register("opposingParty")} />}
          </Field>
        </FormSection>

        <FormSection title="Condução" description="Responsável, situação atual e dados de distribuição.">
          <Field label="Advogado responsável" requirement="required" error={errors.responsibleUserId?.message}>
            {(a) => <Select {...a} {...register("responsibleUserId")} options={lawyers} placeholder="Selecione" />}
          </Field>
          <Field label="Data de distribuição" requirement="optional" error={errors.distributionDate?.message}>
            {(a) => <Input {...a} type="date" {...register("distributionDate")} />}
          </Field>
          <Field label="Status" requirement="required" hint="Sugerido a partir do número CNJ." error={errors.status?.message}>
            {(a) => <Select {...a} {...register("status")} options={opts(PROCESS_STATUSES, PROCESS_STATUS_LABEL)} />}
          </Field>
          <Field label="Fase processual" requirement="required" error={errors.phase?.message}>
            {(a) => <Select {...a} {...register("phase")} options={opts(PROCESS_PHASES, PROCESS_PHASE_LABEL)} />}
          </Field>
          <Field label="Valor da causa" requirement="optional" hint="Dado jurídico da demanda — não se confunde com honorários." error={errors.caseValue?.message}>
            {(a) => <Input {...a} {...register("caseValue")} inputMode="decimal" placeholder="R$ 0,00" className="tabular" />}
          </Field>
        </FormSection>

        <FormSection title="Próximo prazo" description="Opcional. Se preencher algum campo, informe os três.">
          <Field label="Título do prazo" requirement="optional" className="col-span-2" error={errors.deadlineTitle?.message}>
            {(a) => <Input {...a} {...register("deadlineTitle")} placeholder="Ex.: Protocolar petição inicial" />}
          </Field>
          <Field label="Tipo" requirement="optional" error={errors.deadlineType?.message}>
            {(a) => <Select {...a} {...register("deadlineType")} options={opts(DEADLINE_TYPES, DEADLINE_TYPE_LABEL)} placeholder="Selecione" />}
          </Field>
          <Field label="Vencimento" requirement="optional" error={errors.deadlineDueDate?.message}>
            {(a) => <Input {...a} type="date" {...register("deadlineDueDate")} />}
          </Field>
        </FormSection>

        <FormSection title="Observações" description="Notas internas da equipe sobre o processo.">
          <Field label="Observações" requirement="optional" className="col-span-2">
            {(a) => <Textarea {...a} {...register("notes")} rows={4} />}
          </Field>
        </FormSection>
        <PanelFooter className="-mx-7">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Cadastrar processo
          </Button>
        </PanelFooter>
      </Panel>
    </form>
  );
}
