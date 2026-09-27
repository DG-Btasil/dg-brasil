"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { ShieldCheck } from "lucide-react";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABEL } from "@/lib/constants/status";
import { Field, Textarea } from "@/components/ui/form";
import { ToggleChips } from "../components/choice-controls";
import { EditableList, cleanList } from "../components/list-controls";
import { StepForm, StepSection } from "../components/step-section";
import { useRegisterStepForm } from "../hooks";
import { legalCriteriaSchema, withDefaults, type LegalCriteriaValues } from "../schemas";
import type { StepProps } from "../types";

const DOC_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== "OTHER" && c !== "COURT_DECISION" && c !== "PETITION").map((c) => ({
  value: c,
  label: DOCUMENT_CATEGORY_LABEL[c],
}));

const DEFAULTS: LegalCriteriaValues = {
  acceptanceCriteria: "",
  minimumDocuments: [],
  mainTheses: "",
  rejectionSituations: "",
  preferredReferences: "",
  restrictions: "",
  agentRules: [""],
};

export function LegalCriteriaStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<LegalCriteriaValues>({ resolver: zodResolver(legalCriteriaSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave({ ...v, agentRules: cleanList(v.agentRules) }))}>
      <StepSection title="Aceite de casos" columns={1}>
        <Field
          label="Critérios para aceitar um caso"
          requirement="required"
          hint="Ex.: contrato identificado, desconto ativo nos últimos 5 anos, cliente com documentação mínima."
          error={errors.acceptanceCriteria?.message}
        >
          {(p) => <Textarea {...p} rows={4} {...register("acceptanceCriteria")} />}
        </Field>
        <Controller
          control={control}
          name="minimumDocuments"
          render={({ field }) => (
            <ToggleChips
              legend="Documentos mínimos para iniciar a análise"
              requirement="required"
              options={DOC_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              inputRef={field.ref}
              error={errors.minimumDocuments?.message}
              size="sm"
            />
          )}
        />
        <Field label="Situações de rejeição" requirement="recommended" error={errors.rejectionSituations?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Quando o escritório não aceita o caso, mesmo dentro da área." {...register("rejectionSituations")} />}
        </Field>
      </StepSection>

      <StepSection title="Teses e referências" columns={1}>
        <Field label="Teses principais" requirement="recommended" hint="Liste as teses que o escritório mais utiliza, uma por linha." error={errors.mainTheses?.message}>
          {(p) => <Textarea {...p} rows={4} {...register("mainTheses")} />}
        </Field>
        <Field
          label="Jurisprudência e referências preferidas"
          requirement="optional"
          hint="Os agentes usam somente referências cadastradas pelo escritório. O sistema nunca inventa julgados, números de processo ou ementas."
          error={errors.preferredReferences?.message}
        >
          {(p) => <Textarea {...p} rows={4} {...register("preferredReferences")} />}
        </Field>
        <Field label="Restrições" requirement="optional" hint="Temas, teses ou argumentos que não devem ser usados." error={errors.restrictions?.message}>
          {(p) => <Textarea {...p} rows={3} {...register("restrictions")} />}
        </Field>
      </StepSection>

      <StepSection title="Regras para os agentes" columns={1}>
        <p className="flex items-start gap-2 text-[12px] text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-navy-600" aria-hidden />
          Estas regras entram na proposta de configuração da etapa &quot;Agentes e Skills&quot; e só mudam com aprovação humana.
        </p>
        <Controller
          control={control}
          name="agentRules"
          render={({ field }) => (
            <EditableList
              legend="Regras que os agentes devem respeitar"
              requirement="recommended"
              itemLabel="Regra"
              addLabel="Adicionar regra"
              placeholder="Ex.: Não concluir pela viabilidade sem extrato legível."
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </StepSection>
    </StepForm>
  );
}
