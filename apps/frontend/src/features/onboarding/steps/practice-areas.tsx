"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { COURTS, LEGAL_AREAS, LEGAL_AREA_LABEL } from "@/lib/constants/legal";
import { Field, Select, Textarea } from "@/components/ui/form";
import { ToggleChips } from "../components/choice-controls";
import { TagInput } from "../components/list-controls";
import { StepForm, StepSection, Wide } from "../components/step-section";
import { useRegisterStepForm } from "../hooks";
import { practiceAreasSchema, withDefaults, type PracticeAreasValues } from "../schemas";
import type { StepProps } from "../types";

const AREA_OPTIONS = LEGAL_AREAS.map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));
const COURT_OPTIONS = COURTS.map((c) => ({ value: c, label: c }));

const DEFAULTS: PracticeAreasValues = {
  areas: [],
  subareas: [],
  actionTypes: [],
  mainArea: "",
  regions: "",
  courts: [],
  frequentCases: "",
};

export function PracticeAreasStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<PracticeAreasValues>({ resolver: zodResolver(practiceAreasSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);
  const areas = useWatch({ control, name: "areas" });
  const mainOptions = (areas ?? []).map((a) => ({ value: a, label: LEGAL_AREA_LABEL[a] }));

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <StepSection title="Áreas" columns={1}>
        <Controller
          control={control}
          name="areas"
          render={({ field }) => (
            <ToggleChips
              legend="Áreas de atuação"
              requirement="required"
              options={AREA_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              inputRef={field.ref}
              error={errors.areas?.message}
            />
          )}
        />
        <Field
          label="Atuação principal"
          requirement="required"
          hint={mainOptions.length ? "Define a prioridade das Skills e teses iniciais." : "Selecione as áreas acima para escolher a principal."}
          error={errors.mainArea?.message}
        >
          {(p) => <Select {...p} options={mainOptions} placeholder="Selecione" {...register("mainArea")} />}
        </Field>
      </StepSection>

      <StepSection title="Detalhamento">
        <Controller
          control={control}
          name="subareas"
          render={({ field }) => (
            <TagInput label="Subáreas" value={field.value} onChange={field.onChange} inputRef={field.ref} placeholder="Ex.: Consignado INSS" />
          )}
        />
        <Controller
          control={control}
          name="actionTypes"
          render={({ field }) => (
            <TagInput label="Tipos de ação" requirement="recommended" value={field.value} onChange={field.onChange} inputRef={field.ref} placeholder="Ex.: Revisional de contrato" />
          )}
        />
        <Wide>
          <Field label="Regiões de atuação" requirement="optional" hint="Cidades ou regiões onde o escritório concentra casos." error={errors.regions?.message}>
            {(p) => <Textarea {...p} rows={2} {...register("regions")} />}
          </Field>
        </Wide>
        <Wide>
          <Controller
            control={control}
            name="courts"
            render={({ field }) => (
              <ToggleChips
                legend="Tribunais em que atua com frequência"
                requirement="recommended"
                options={COURT_OPTIONS}
                value={field.value}
                onChange={field.onChange}
                inputRef={field.ref}
                size="sm"
              />
            )}
          />
        </Wide>
        <Wide>
          <Field label="Casos mais frequentes" requirement="recommended" hint="Descreva em poucas linhas os casos que mais chegam ao escritório." error={errors.frequentCases?.message}>
            {(p) => <Textarea {...p} rows={4} {...register("frequentCases")} />}
          </Field>
        </Wide>
      </StepSection>
    </StepForm>
  );
}
