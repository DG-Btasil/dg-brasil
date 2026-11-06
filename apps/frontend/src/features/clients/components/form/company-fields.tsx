"use client";

import { useState } from "react";
import { useFormContext, useWatch, type FieldPath } from "react-hook-form";
import { autofillHint, useCnpjAutofill } from "@/features/lookup/use-autofill";
import { INPUT_MASKS } from "@/lib/formatting/masks";
import { Field, FormSection, Input, MaskedInput } from "@/components/ui/form";
import type { CompanyFormValues } from "../../schemas";

export function CompanyDataFields() {
  const {
    register,
    control,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<CompanyFormValues>();
  // Roadmap 2.0: CNPJ completo → razão social, nome fantasia, abertura, natureza, contato e sede (BrasilAPI).
  const cnpj = useWatch({ control, name: "cnpj" });
  const [situation, setSituation] = useState<string>();
  const cnpjStatus = useCnpjAutofill(cnpj, (c) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    const fillIfEmpty = (name: FieldPath<CompanyFormValues>, value: string | undefined) => {
      if (value && !String(getValues(name) ?? "").trim()) setValue(name, value as never, opts);
    };
    if (c.legalName) setValue("legalName", c.legalName, opts);
    fillIfEmpty("tradeName", c.tradeName);
    fillIfEmpty("openingDate", c.openingDate);
    fillIfEmpty("legalNature", c.legalNature);
    fillIfEmpty("email", c.email);
    fillIfEmpty("phone", c.phone ? INPUT_MASKS.phone(c.phone) : undefined);
    if (c.address && !String(getValues("address.zipCode") ?? "").trim()) {
      fillIfEmpty("address.street", c.address.street);
      fillIfEmpty("address.number", c.address.number);
      fillIfEmpty("address.complement", c.address.complement);
      fillIfEmpty("address.district", c.address.district);
      fillIfEmpty("address.city", c.address.city);
      fillIfEmpty("address.state", c.address.state);
      setValue("address.zipCode", INPUT_MASKS.cep(c.address.zipCode), opts);
    }
    setSituation(c.registrationStatus && c.registrationStatus.toUpperCase() !== "ATIVA" ? c.registrationStatus : undefined);
  });
  return (
    <FormSection
      title="Empresa"
      description="Dados da empresa para a qualificação nas peças."
    >
      <Field label="Razão social" requirement="required" error={errors.legalName?.message}>
        {(p) => <Input {...p} {...register("legalName")} />}
      </Field>
      <Field label="Nome fantasia" requirement="recommended">
        {(p) => <Input {...p} {...register("tradeName")} />}
      </Field>
      <Field
        label="CNPJ"
        requirement="required"
        error={errors.cnpj?.message}
        hint={situation ? `Atenção: situação na Receita — ${situation}.` : autofillHint(cnpjStatus, "CNPJ")}
      >
        {(p) => <MaskedInput mask="cnpj" placeholder="00.000.000/0000-00" {...p} {...register("cnpj")} />}
      </Field>
      <Field label="Data de abertura" requirement="recommended">
        {(p) => <Input type="date" {...p} {...register("openingDate")} />}
      </Field>
      <Field label="Natureza jurídica" requirement="recommended">
        {(p) => <Input placeholder="Ex.: Sociedade Empresária Limitada" {...p} {...register("legalNature")} />}
      </Field>
    </FormSection>
  );
}

export function CompanyContactFields() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CompanyFormValues>();
  return (
    <FormSection title="Contato">
      <Field label="E-mail" requirement="required" error={errors.email?.message}>
        {(p) => <Input type="email" placeholder="contato@exemplo.com" {...p} {...register("email")} />}
      </Field>
      <Field label="Telefone" requirement="required" error={errors.phone?.message}>
        {(p) => <MaskedInput mask="phone" placeholder="(00) 0000-0000" {...p} {...register("phone")} />}
      </Field>
    </FormSection>
  );
}
