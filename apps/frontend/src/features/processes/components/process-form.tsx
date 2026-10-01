"use client";

import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CLIENT_POLE_LABEL, CLIENT_POLES, DEADLINE_TYPE_LABEL, DEADLINE_TYPES, PROCESS_PHASE_LABEL, PROCESS_PHASES, PROCESS_STATUS_LABEL, PROCESS_STATUSES } from "@/lib/constants/status";
import { BRAZILIAN_STATES, COURTS, LEGAL_AREA_LABEL, LEGAL_AREAS } from "@/lib/constants/legal";
import { onlyDigits } from "@/lib/formatting";
import { parseCurrencyInput } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { useLegalCases, useOfficeNames } from "@/features/cases/hooks";
import { useClientMap, useLawyerOptions, type NewProcessInput } from "../hooks";
import { processFormSchema, type ProcessFormInput, type ProcessFormValues } from "../schemas";
import { clientDisplayName } from "../utils";

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));
const DEFAULT_DEADLINE_TITLE = "Acompanhamento do processo";
const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);

function toInput(v: ProcessFormValues): NewProcessInput {
  return {
    legalCaseId: v.legalCaseId,
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
    // Vencimento é obrigatório; descrição e tipo têm padrão para não travar o cadastro.
    nextDeadline: {
      title: v.deadlineTitle?.trim() || DEFAULT_DEADLINE_TITLE,
      type: v.deadlineType || "INTERNAL",
      dueDate: v.deadlineDueDate,
    },
  };
}

export function ProcessForm({
  initialCaseId,
  clientFilter,
  onSubmit,
  onCancel,
}: {
  initialCaseId: string;
  /** Restringe os casos a um cliente (ex.: vindo da página do cliente). */
  clientFilter?: string;
  onSubmit: (input: NewProcessInput) => Promise<void>;
  onCancel: () => void;
}) {
  const cases = useLegalCases();
  const clientMap = useClientMap();
  const officeName = useOfficeNames();
  const lawyers = useLawyerOptions();
  // Processo só entra em caso enviado ou aceito (não em rascunho, rejeitado ou arquivado).
  const caseOptions = useMemo(
    () =>
      cases
        .filter((c) => c.status !== "DRAFT" && c.status !== "REJECTED" && c.status !== "ARCHIVED" && (!clientFilter || c.clientId === clientFilter))
        .map((c) => ({ value: c.id, label: `${c.title} · ${clientDisplayName(clientMap.get(c.clientId))}` }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [cases, clientMap, clientFilter],
  );
  const initialCase = cases.find((c) => c.id === initialCaseId);
  const initialResponsible = initialCase?.assignedLawyerId ?? (initialCase ? clientMap.get(initialCase.clientId)?.responsibleUserId : undefined);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<ProcessFormInput, unknown, ProcessFormValues>({
    resolver: zodResolver(processFormSchema),
    defaultValues: {
      legalCaseId: initialCaseId,
      responsibleUserId: lawyers.some((l) => l.value === initialResponsible) ? initialResponsible : "",
      status: "PRE_FILING",
      phase: "PRELIMINARY",
      clientPole: "ACTIVE",
    },
    shouldFocusError: true,
  });

  const caseId = useWatch({ control, name: "legalCaseId" });
  const selectedCase = cases.find((c) => c.id === caseId);

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
        <FormSection title="Caso e identificação" description="Todo processo pertence a um caso. O cliente e a origem são os do caso. O número CNJ pode ficar em branco em pré-ajuizamento.">
          <Field label="Caso relacionado" requirement="required" error={errors.legalCaseId?.message} hint={selectedCase ? `Origem do caso: ${officeName(selectedCase.originOfficeId)}` : undefined}>
            {(a) => <Select {...a} {...register("legalCaseId")} options={caseOptions} placeholder="Selecione o caso" />}
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

        <FormSection
          title="Vencimento"
          description="Data operacional principal do processo. Obrigatória: é ela que organiza tarefas, alertas, prazos e prioridades."
        >
          <Field label="Data de vencimento" requirement="required" hint="Vencimento do próximo prazo ou providência." error={errors.deadlineDueDate?.message}>
            {(a) => <Input {...a} type="date" {...register("deadlineDueDate")} />}
          </Field>
          <Field label="Tipo" requirement="optional" hint="Sem seleção, fica como prazo interno." error={errors.deadlineType?.message}>
            {(a) => <Select {...a} {...register("deadlineType")} options={opts(DEADLINE_TYPES, DEADLINE_TYPE_LABEL)} placeholder="Selecione" />}
          </Field>
          <Field label="Descrição do prazo" requirement="optional" className="col-span-2" hint={`Sem descrição, fica “${DEFAULT_DEADLINE_TITLE}”.`} error={errors.deadlineTitle?.message}>
            {(a) => <Input {...a} {...register("deadlineTitle")} placeholder="Ex.: Protocolar petição inicial" />}
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
