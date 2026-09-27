"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Segmented } from "../components/choice-controls";
import { StepForm, StepSection, Wide } from "../components/step-section";
import { UploadZone } from "../components/upload-zone";
import { useRegisterStepForm } from "../hooks";
import { FORMALITY_LABEL, LENGTH_LABEL } from "../labels";
import { FORMALITY_LEVELS, TEXT_LENGTHS, writingStyleSchema, withDefaults, type WritingStyleValues } from "../schemas";
import type { StepProps } from "../types";

const FORMALITY_OPTIONS = FORMALITY_LEVELS.map((v) => ({ value: v, label: FORMALITY_LABEL[v] }));
const LENGTH_OPTIONS = TEXT_LENGTHS.map((v) => ({ value: v, label: LENGTH_LABEL[v] }));

const DEFAULTS: WritingStyleValues = {
  formality: "FORMAL",
  length: "BALANCED",
  structure: "",
  style: "",
  vocabulary: "",
  argumentation: "",
  addressForms: "",
  citationPreferences: "",
  avoid: "",
  files: [],
};

export function WritingStyleStep({ formId, answers, onSave, registerForm }: StepProps) {
  const form = useForm<WritingStyleValues>({ resolver: zodResolver(writingStyleSchema), defaultValues: withDefaults(DEFAULTS, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  useRegisterStepForm(form, registerForm);

  return (
    <StepForm id={formId} onSubmit={handleSubmit((v) => onSave(v))}>
      <StepSection title="Tom e extensão">
        <Controller
          control={control}
          name="formality"
          render={({ field }) => (
            <Segmented legend="Grau de formalidade" requirement="required" options={FORMALITY_OPTIONS} value={field.value} onChange={field.onChange} inputRef={field.ref} />
          )}
        />
        <Controller
          control={control}
          name="length"
          render={({ field }) => (
            <Segmented legend="Extensão preferida" requirement="required" options={LENGTH_OPTIONS} value={field.value} onChange={field.onChange} inputRef={field.ref} />
          )}
        />
      </StepSection>

      <StepSection title="Estilo do escritório">
        <Field label="Estrutura das peças" requirement="recommended" error={errors.structure?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Ex.: síntese inicial, fatos, fundamentos, pedidos numerados." {...register("structure")} />}
        </Field>
        <Field label="Estilo de escrita" requirement="optional" error={errors.style?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Ex.: frases curtas, voz ativa, parágrafos objetivos." {...register("style")} />}
        </Field>
        <Field label="Vocabulário" requirement="optional" error={errors.vocabulary?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Termos preferidos e termos a evitar." {...register("vocabulary")} />}
        </Field>
        <Field label="Padrões de argumentação" requirement="optional" error={errors.argumentation?.message}>
          {(p) => <Textarea {...p} rows={3} placeholder="Ex.: fundamento legal antes do precedente." {...register("argumentation")} />}
        </Field>
        <Field label="Formas de tratamento" requirement="optional" error={errors.addressForms?.message}>
          {(p) => <Input {...p} placeholder="Ex.: Excelentíssimo(a) Senhor(a) Doutor(a) Juiz(a)" {...register("addressForms")} />}
        </Field>
        <Field label="Preferências de citação" requirement="optional" error={errors.citationPreferences?.message}>
          {(p) => <Input {...p} placeholder="Ex.: citar apenas trechos essenciais, com referência completa." {...register("citationPreferences")} />}
        </Field>
        <Wide>
          <Field label="O que evitar" requirement="recommended" error={errors.avoid?.message}>
            {(p) => <Textarea {...p} rows={2} {...register("avoid")} />}
          </Field>
        </Wide>
      </StepSection>

      <StepSection title="Peças de referência" columns={1}>
        <Controller
          control={control}
          name="files"
          render={({ field }) => (
            <UploadZone
              title="Envie peças anteriores para ajudar o DG Brasil a compreender o padrão do escritório."
              files={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </StepSection>
    </StepForm>
  );
}
