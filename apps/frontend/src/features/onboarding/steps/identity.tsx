"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { Plus, X } from "lucide-react";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, MaskedInput, Select } from "@/components/ui/form";
import { useOffice } from "@/features/offices/hooks";
import { ToggleChips } from "../components/choice-controls";
import { StepForm, StepSection, Wide } from "../components/step-section";
import { useOnboardingActions, useRegisterStepForm } from "../hooks";
import { identitySchema, withDefaults, type IdentityValues } from "../schemas";
import type { StepProps } from "../types";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

export function IdentityStep({ formId, answers, onSave, registerForm }: StepProps) {
  const office = useOffice();
  const { updateOfficeIdentity } = useOnboardingActions();
  const a = office.address;
  const fromOffice: IdentityValues = {
    name: office.name,
    legalName: office.legalName ?? "",
    cnpj: office.cnpj ?? "",
    tradeName: office.tradeName ?? "",
    zipCode: a?.zipCode ?? "",
    street: a?.street ?? "",
    number: a?.number ?? "",
    complement: a?.complement ?? "",
    district: a?.district ?? "",
    city: a?.city ?? "",
    state: a?.state ?? "",
    phone: office.phone ?? "",
    email: office.email ?? "",
    website: office.website ?? "",
    principalLawyer: office.principalLawyer,
    oab: office.oab ?? "",
    statesOfPractice: office.statesOfPractice.filter((s): s is IdentityValues["statesOfPractice"][number] =>
      (BRAZILIAN_STATES as readonly string[]).includes(s),
    ),
    units: (office.units.length ? office.units : [""]).map((value) => ({ value })),
  };

  const form = useForm<IdentityValues>({ resolver: zodResolver(identitySchema), defaultValues: withDefaults(fromOffice, answers) });
  const { register, control, handleSubmit, formState } = form;
  const { errors } = formState;
  const units = useFieldArray({ control, name: "units" });
  useRegisterStepForm(form, registerForm);

  const submit = handleSubmit(async (values) => {
    await updateOfficeIdentity(values);
    await onSave({ ...values, units: values.units.filter((u) => u.value.trim()) });
  });

  return (
    <StepForm id={formId} onSubmit={submit}>
      <StepSection title="Dados institucionais">
        <Field label="Nome do escritório" requirement="required" error={errors.name?.message}>
          {(p) => <Input {...p} {...register("name")} autoComplete="organization" />}
        </Field>
        <Field label="Nome fantasia" requirement="recommended" error={errors.tradeName?.message}>
          {(p) => <Input {...p} {...register("tradeName")} />}
        </Field>
        <Field label="Razão social" requirement="optional" error={errors.legalName?.message}>
          {(p) => <Input {...p} {...register("legalName")} />}
        </Field>
        <Field label="CNPJ" requirement="optional" error={errors.cnpj?.message}>
          {(p) => <MaskedInput {...p} mask="cnpj" placeholder="00.000.000/0000-00" {...register("cnpj")} />}
        </Field>
      </StepSection>

      <StepSection title="Endereço da sede">
        <Field label="CEP" requirement="recommended" error={errors.zipCode?.message}>
          {(p) => <MaskedInput {...p} mask="cep" placeholder="00000-000" {...register("zipCode")} />}
        </Field>
        <div className="hidden sm:block" />
        <Wide className="grid grid-cols-[minmax(0,1fr)_120px] gap-5">
          <Field label="Logradouro" requirement="recommended" error={errors.street?.message}>
            {(p) => <Input {...p} {...register("street")} autoComplete="address-line1" />}
          </Field>
          <Field label="Número" requirement="recommended" error={errors.number?.message}>
            {(p) => <Input {...p} {...register("number")} />}
          </Field>
        </Wide>
        <Field label="Complemento" requirement="optional" error={errors.complement?.message}>
          {(p) => <Input {...p} {...register("complement")} />}
        </Field>
        <Field label="Bairro" requirement="recommended" error={errors.district?.message}>
          {(p) => <Input {...p} {...register("district")} />}
        </Field>
        <Field label="Cidade" requirement="required" error={errors.city?.message}>
          {(p) => <Input {...p} {...register("city")} autoComplete="address-level2" />}
        </Field>
        <Field label="UF" requirement="required" error={errors.state?.message}>
          {(p) => <Select {...p} options={UF_OPTIONS} placeholder="Selecione" {...register("state")} />}
        </Field>
      </StepSection>

      <StepSection title="Contato e responsável">
        <Field label="Telefone" requirement="required" error={errors.phone?.message}>
          {(p) => <MaskedInput {...p} mask="phone" placeholder="(00) 0000-0000" {...register("phone")} autoComplete="tel" />}
        </Field>
        <Field label="E-mail institucional" requirement="required" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" {...register("email")} autoComplete="email" />}
        </Field>
        <Field label="Site" requirement="optional" error={errors.website?.message}>
          {(p) => <Input {...p} placeholder="www.seuescritorio.com.br" {...register("website")} />}
        </Field>
        <div className="hidden sm:block" />
        <Field label="Responsável principal" requirement="required" error={errors.principalLawyer?.message}>
          {(p) => <Input {...p} {...register("principalLawyer")} />}
        </Field>
        <Field label="OAB do responsável" requirement="required" hint="Ex.: OAB/SP 123456" error={errors.oab?.message}>
          {(p) => <MaskedInput {...p} mask="oab" {...register("oab")} />}
        </Field>
      </StepSection>

      <StepSection title="Atuação territorial" columns={1}>
        <Controller
          control={control}
          name="statesOfPractice"
          render={({ field }) => (
            <ToggleChips
              legend="Estados de atuação"
              requirement="required"
              hint="Casos de outros estados serão sinalizados pelos agentes."
              options={UF_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              inputRef={field.ref}
              error={errors.statesOfPractice?.message}
              size="sm"
            />
          )}
        />
        <fieldset>
          <legend className="mb-1.5 flex w-full items-baseline justify-between">
            <span className="text-[12.5px] font-medium text-foreground">Unidades / escritórios</span>
            <span className="text-[11px] text-subtle">Opcional</span>
          </legend>
          <ul className="space-y-2">
            {units.fields.map((f, i) => (
              <li key={f.id} className="flex items-center gap-2">
                <Input aria-label={`Unidade ${i + 1}`} placeholder="Ex.: São Paulo — Sede" {...register(`units.${i}.value`)} />
                <IconButton label={`Remover unidade ${i + 1}`} size="sm" onClick={() => units.remove(i)}>
                  <X className="size-4" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => units.append({ value: "" })} icon={<Plus className="size-4" aria-hidden />}>
            Adicionar unidade
          </Button>
        </fieldset>
      </StepSection>
    </StepForm>
  );
}
