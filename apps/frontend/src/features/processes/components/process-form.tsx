"use client";

import { useCallback, useRef, useState } from "react";
import { FormProvider, useForm, useFormContext, useWatch, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CLIENT_POLE_LABEL, CLIENT_POLES, PROCESS_PHASE_LABEL, PROCESS_PHASES, PROCESS_STATUS_LABEL, PROCESS_STATUSES } from "@/lib/constants/status";
import { courtName, searchCourts } from "@/lib/constants/courts";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { onlyDigits } from "@/lib/formatting";
import { CASE_STATUSES_FOR_PROCESS } from "@/lib/domain/legal-case";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { AsyncPicker, type PickerOption } from "@/components/ui/async-picker";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { listCasesAction } from "@/server/domain/cases/actions";
import type { ProcessInternalDTO } from "@/server/domain/processes/dto";
import { useLawyerOptions } from "@/features/directory/directory-context";
import { processEditSchema, processFormSchema, type ProcessEditValues, type ProcessFormInput, type ProcessFormValues } from "../schemas";
import { processCreateInput, processEditPatch } from "../server-input";

const opts = <T extends string>(values: readonly T[], labels?: Record<T, string>) => values.map((v) => ({ value: v, label: labels ? labels[v] : v }));
/** Processo só entra em caso enviado, em análise, aceito, em andamento ou encerrado. */

/** Busca de casos aptos a receber processo (servidor + RLS). Guarda o responsável de cada um. */
function useCaseSearch(lawyerOf: React.MutableRefObject<Map<string, string | undefined>>) {
  return useCallback(
    async (q: string): Promise<{ ok: true; options: PickerOption[] } | { ok: false; message: string }> => {
      const r = await callAction(() => listCasesAction({ q: q.trim() || undefined, status: CASE_STATUSES_FOR_PROCESS, pageSize: 10, sortBy: "updatedAt", sortDirection: "desc" }));
      if (!r.ok) return { ok: false, message: r.error.message };
      r.data.items.forEach((c) => lawyerOf.current.set(c.id, c.assignedLawyerId));
      return { ok: true, options: r.data.items.map((c) => ({ id: c.id, label: c.title, description: c.clientName })) };
    },
    [lawyerOf],
  );
}

/** Todos os tribunais cabem na lista aberta; a busca só filtra. */
const searchCourtOptions = async (q: string) => ({
  ok: true as const,
  options: searchCourts(q, 100).map((c): PickerOption => ({ id: c.code, label: c.code, description: c.name })),
});

/**
 * Tribunal com busca por sigla ou nome. Grava a sigla. Texto fora da lista
 * (processo importado de planilha) aparece como está e só muda se a pessoa trocar.
 */
function CourtField() {
  const { control, setValue } = useFormContext<ProcessFormInput>();
  const court = useWatch({ control, name: "court" });
  return (
    <Field label="Tribunal" requirement="optional" hint="Busque pela sigla ou pelo nome. Ex.: TJRJ, trabalho 1, federal 2.">
      {(a) => (
        <AsyncPicker
          {...a}
          value={court ? { id: court, label: court, description: courtName(court) } : null}
          search={searchCourtOptions}
          placeholder="Buscar tribunal"
          emptyText="Nenhum tribunal encontrado."
          onChange={(o) => setValue("court", o?.id ?? "", { shouldDirty: true })}
        />
      )}
    </Field>
  );
}

/** Valor em reais para o campo de texto ("1234.5" → "1234,50"). */
const currencyField = (v: number | undefined) => (v === undefined ? "" : v.toFixed(2).replace(".", ","));

function ProcessFieldSections({ cnjHint }: { cnjHint: boolean }) {
  const lawyers = useLawyerOptions();
  const {
    register,
    formState: { errors },
  } = useFormContext<ProcessFormInput>();
  return (
    <>
      <FormSection title="Juízo" description="Onde o processo tramita ou tramitará.">
        <CourtField />
        <Field label="Unidade / vara" requirement="optional">
          {(a) => <Input {...a} {...register("unit")} maxLength={200} placeholder="Ex.: 2ª Vara Cível" />}
        </Field>
        <Field label="Comarca" requirement="optional">
          {(a) => <Input {...a} {...register("district")} maxLength={120} />}
        </Field>
        <Field label="UF" requirement="optional" error={errors.state?.message}>
          {(a) => <Select {...a} {...register("state")} options={opts(BRAZILIAN_STATES)} placeholder="Selecione" />}
        </Field>
      </FormSection>

      <FormSection title="Objeto e partes" description="Classificação jurídica e posição do cliente na demanda. A área jurídica é a do caso.">
        <Field label="Tipo de ação" requirement="required" error={errors.actionType?.message}>
          {(a) => <Input {...a} {...register("actionType")} maxLength={200} placeholder="Ex.: Ação revisional de contrato bancário" />}
        </Field>
        <Field label="Assunto" requirement="optional">
          {(a) => <Input {...a} {...register("subject")} maxLength={300} />}
        </Field>
        <Field label="Polo do cliente" requirement="required" error={errors.clientPole?.message}>
          {(a) => <Select {...a} {...register("clientPole")} options={opts(CLIENT_POLES, CLIENT_POLE_LABEL)} />}
        </Field>
        <Field label="Parte contrária" requirement="recommended">
          {(a) => <Input {...a} {...register("opposingParty")} maxLength={500} />}
        </Field>
      </FormSection>

      <FormSection title="Condução" description="Responsável, situação atual, distribuição, valor da causa e honorários (dados internos, que o parceiro não vê).">
        <Field label="Advogado responsável" requirement="required" hint="Administrador aparece aqui depois de cadastrar a OAB em Sua conta." error={errors.responsibleUserId?.message}>
          {(a) => <Select {...a} {...register("responsibleUserId")} options={lawyers} placeholder="Selecione" />}
        </Field>
        <Field label="Data de distribuição" requirement="optional" error={errors.distributionDate?.message}>
          {(a) => <Input {...a} type="date" {...register("distributionDate")} />}
        </Field>
        <Field label="Situação" requirement="required" hint={cnjHint ? "Sugerido a partir do número CNJ." : undefined} error={errors.status?.message}>
          {(a) => <Select {...a} {...register("status")} options={opts(PROCESS_STATUSES, PROCESS_STATUS_LABEL)} />}
        </Field>
        <Field label="Fase processual" requirement="required" error={errors.phase?.message}>
          {(a) => <Select {...a} {...register("phase")} options={opts(PROCESS_PHASES, PROCESS_PHASE_LABEL)} />}
        </Field>
        <Field label="Valor da causa" requirement="optional" hint="Dado jurídico da demanda — não se confunde com honorários." error={errors.caseValue?.message}>
          {(a) => <Input {...a} {...register("caseValue")} inputMode="decimal" placeholder="R$ 0,00" className="tabular" />}
        </Field>
        <Field label="Honorários (R$)" requirement="optional" hint="Valor contratado ou esperado neste processo. Interno: o parceiro não vê." error={errors.feeAmount?.message}>
          {(a) => <Input {...a} {...register("feeAmount")} inputMode="decimal" placeholder="R$ 0,00" className="tabular" />}
        </Field>
        <Field label="Honorários de êxito (%)" requirement="optional" hint="Percentual sobre o proveito, de 0 a 100. Interno." error={errors.feePercentage?.message}>
          {(a) => <Input {...a} {...register("feePercentage")} inputMode="decimal" placeholder="Ex.: 30" className="tabular" />}
        </Field>
      </FormSection>

      <FormSection title="Observações" description="Notas internas da equipe sobre o processo.">
        <Field label="Observações" requirement="optional" className="col-span-2">
          {(a) => <Textarea {...a} {...register("notes")} rows={4} />}
        </Field>
      </FormSection>
    </>
  );
}

/** Erros de campo do servidor → campos do formulário. */
const SERVER_FIELD_MAP: Record<string, string> = { legalCaseId: "legalCaseId" };

/**
 * Cadastro de processo. `onSubmit` recebe a entrada da action (e o título do
 * caso escolhido, que é o nome do processo) e devolve o resultado; erro de
 * campo volta para o campo, o resto o chamador avisa.
 */
export function ProcessForm({
  initialCase,
  onSubmit,
  onCancel,
}: {
  initialCase?: PickerOption & { lawyerId?: string };
  onSubmit: (input: Record<string, unknown>, meta: { caseTitle?: string }) => Promise<ActionResult<unknown>>;
  onCancel: () => void;
}) {
  const lawyers = useLawyerOptions();
  const lawyerOf = useRef(new Map<string, string | undefined>(initialCase ? [[initialCase.id, initialCase.lawyerId]] : []));
  const searchCases = useCaseSearch(lawyerOf);
  const [caseOption, setCaseOption] = useState<PickerOption | null>(initialCase ?? null);
  const methods = useForm<ProcessFormInput, unknown, ProcessFormValues>({
    resolver: zodResolver(processFormSchema),
    defaultValues: {
      legalCaseId: initialCase?.id ?? "",
      responsibleUserId: lawyers.some((l) => l.value === initialCase?.lawyerId) ? initialCase?.lawyerId : "",
      status: "PRE_FILING",
      phase: "PRELIMINARY",
      clientPole: "ACTIVE",
    },
    shouldFocusError: true,
  });
  const {
    register,
    handleSubmit,
    setValue,
    setError,
    control,
    getValues,
    formState: { errors, isSubmitting, dirtyFields },
  } = methods;
  useWatch({ control, name: "legalCaseId" });

  // Status padrão acompanha o CNJ enquanto o usuário não escolhe outro:
  // sem número, pré-ajuizamento; com número, em andamento na fase processual.
  const cnjField = register("cnj", {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (dirtyFields.status) return;
      const hasCnj = onlyDigits(e.target.value).length > 0;
      setValue("status", hasCnj ? "ACTIVE" : "PRE_FILING");
      setValue("phase", hasCnj ? "PROCEEDINGS" : "PRELIMINARY");
    },
  });

  const submit = handleSubmit(async (values) => {
    const result = await onSubmit(processCreateInput(values), { caseTitle: caseOption?.label });
    if (result.ok) return;
    const fields = mapFieldErrors(result.error.fieldErrors, SERVER_FIELD_MAP);
    Object.entries(fields).forEach(([name, message], i) => setError(name as Path<ProcessFormInput>, { message }, { shouldFocus: i === 0 }));
  });

  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={submit}>
        <Panel className="px-7">
          <FormSection
            title="Caso e identificação"
            description="Todo processo pertence a um caso e é identificado pelo nome do caso. O cliente e a origem são os do caso. O número CNJ pode ficar em branco em pré-ajuizamento."
          >
            <Field label="Caso relacionado" requirement="required" error={errors.legalCaseId?.message} hint={caseOption?.description ? `Cliente: ${caseOption.description}` : undefined}>
              {(a) => (
                <AsyncPicker
                  {...a}
                  value={caseOption}
                  search={searchCases}
                  placeholder="Buscar caso pelo título"
                  onChange={(o) => {
                    setCaseOption(o);
                    setValue("legalCaseId", o?.id ?? "", { shouldValidate: !!o });
                    const lawyer = o ? lawyerOf.current.get(o.id) : undefined;
                    if (lawyer && !getValues("responsibleUserId") && lawyers.some((l) => l.value === lawyer)) setValue("responsibleUserId", lawyer);
                  }}
                />
              )}
            </Field>
            <Field label="Número CNJ" requirement="optional" hint="Formato 0000000-00.0000.0.00.0000" error={errors.cnj?.message}>
              {(a) => <MaskedInput {...a} {...cnjField} mask="cnj" placeholder="0000000-00.0000.0.00.0000" />}
            </Field>
          </FormSection>
          <ProcessFieldSections cnjHint />
          <PanelFooter className="-mx-7">
            <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Cadastrar processo
            </Button>
          </PanelFooter>
        </Panel>
      </form>
    </FormProvider>
  );
}

/** Valores do formulário a partir da ficha (edição). */
function editDefaults(p: ProcessInternalDTO): ProcessFormInput {
  return {
    legalCaseId: p.legalCaseId,
    cnj: p.cnj ?? "",
    court: p.court ?? "",
    unit: p.unit ?? "",
    district: p.district ?? "",
    state: p.state ?? "",
    actionType: p.actionType ?? "",
    subject: p.subject ?? "",
    clientPole: p.clientPole ?? "ACTIVE",
    opposingParty: p.opposingParty ?? "",
    responsibleUserId: p.responsibleUserId ?? "",
    distributionDate: p.distributionDate ?? "",
    caseValue: currencyField(p.caseValue),
    feeAmount: currencyField(p.feeAmount),
    feePercentage: p.feePercentage === undefined ? "" : String(p.feePercentage).replace(".", ","),
    status: p.status,
    phase: p.phase ?? "PRELIMINARY",
    notes: p.notes ?? "",
  };
}

/** Edição dos dados cadastrais (o caso não muda; prazos ficam na aba Prazos). */
export function ProcessEditForm({
  process,
  onSubmit,
  onCancel,
}: {
  process: ProcessInternalDTO;
  onSubmit: (patch: Record<string, unknown>) => Promise<ActionResult<unknown>>;
  onCancel: () => void;
}) {
  const methods = useForm<ProcessFormInput, unknown, ProcessEditValues>({
    resolver: zodResolver(processEditSchema) as never,
    defaultValues: editDefaults(process),
    shouldFocusError: true,
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = methods;

  const submit = handleSubmit(async (values) => {
    const result = await onSubmit(processEditPatch(values));
    if (result.ok) return;
    const fields = mapFieldErrors(result.error.fieldErrors, {}, "patch.");
    Object.entries(fields).forEach(([name, message], i) => setError(name as Path<ProcessFormInput>, { message }, { shouldFocus: i === 0 }));
  });

  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={submit}>
        <Panel className="px-7">
          <FormSection title="Identificação" description={`Caso: ${process.caseTitle || "—"}. O caso do processo não muda.`}>
            <Field label="Número CNJ" requirement="optional" hint="Formato 0000000-00.0000.0.00.0000" error={errors.cnj?.message}>
              {(a) => <MaskedInput {...a} {...register("cnj")} mask="cnj" placeholder="0000000-00.0000.0.00.0000" />}
            </Field>
          </FormSection>
          <ProcessFieldSections cnjHint={false} />
          <PanelFooter className="-mx-7">
            <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Salvar alterações
            </Button>
          </PanelFooter>
        </Panel>
      </form>
    </FormProvider>
  );
}
