"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Segmented, ToggleChips } from "../components/choice-controls";
import { StepForm, StepSection, Wide } from "../components/step-section";
import { useRegisterStepForm } from "../hooks";
import { CLIENT_MIX_LABEL, INTAKE_CHANNELS } from "../labels";
import { CLIENT_MIX, clientProfileSchema, withDefaults, type ClientProfileValues } from "../schemas";
import type { StepProps } from "../types";

const MIX_OPTIONS = CLIENT_MIX.map((v) => ({ value: v, label: CLIENT_MIX_LABEL[v] }));
const CHANNEL_OPTIONS = INTAKE_CHANNELS.map((c) => ({ value: c, label: c }));

const DEFAULTS: ClientProfileValues = {
  clientMix: "INDIVIDUAL",
  targetAudience: "",
  recurringTraits: "",
  regionsServed: "",
  caseProfile: "",
  channels: [],
  notServed: "",
};

export function ClientProfileStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<ClientProfileValues>({ resolver: zodResolver(clientProfileSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <StepSection title="Quem o escritório atende">
        <Wide>
          <Controller
            control={control}
            name="clientMix"
            render={({ field }) => (
              <Segmented legend="Tipo de cliente" requirement="required" options={MIX_OPTIONS} value={field.value} onChange={field.onChange} inputRef={field.ref} />
            )}
          />
        </Wide>
        <Wide>
          <Field label="Público-alvo" requirement="required" hint="Ex.: aposentados e pensionistas do INSS com descontos em folha." error={errors.targetAudience?.message}>
            {(p) => <Input {...p} {...register("targetAudience")} />}
          </Field>
        </Wide>
        <Field label="Características recorrentes" requirement="recommended" error={errors.recurringTraits?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Faixa etária, familiaridade com tecnologia, renda…" {...register("recurringTraits")} />}
        </Field>
        <Field label="Perfil dos casos" requirement="recommended" error={errors.caseProfile?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Valor típico, complexidade, urgência…" {...register("caseProfile")} />}
        </Field>
        <Wide>
          <Field label="Regiões atendidas" requirement="optional" error={errors.regionsServed?.message}>
            {(p) => <Input {...p} placeholder="Ex.: Grande São Paulo e interior de MG" {...register("regionsServed")} />}
          </Field>
        </Wide>
      </StepSection>

      <StepSection title="Entrada e limites" columns={1}>
        <Controller
          control={control}
          name="channels"
          render={({ field }) => (
            <ToggleChips legend="Canais de entrada" requirement="recommended" options={CHANNEL_OPTIONS} value={field.value} onChange={field.onChange} inputRef={field.ref} />
          )}
        />
        <Field
          label="Clientes ou casos que o escritório não atende"
          requirement="recommended"
          hint="A triagem passa a sinalizar esses perfis logo na entrada."
          error={errors.notServed?.message}
        >
          {(p) => <Textarea {...p} rows={3} {...register("notServed")} />}
        </Field>
      </StepSection>
    </StepForm>
  );
}
