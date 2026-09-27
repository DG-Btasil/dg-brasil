"use client";

import { useFormContext } from "react-hook-form";
import { Field, FormSection, Input, MaskedInput, Textarea } from "@/components/ui/form";
import type { CompanyFormValues } from "../../schemas";

export function CompanyDataFields() {
  const {
    register,
    formState: { errors },
  } = useFormContext<CompanyFormValues>();
  return (
    <FormSection
      title="Empresa"
      description="No protótipo não há consulta a bases governamentais. Os dados cadastrais são informados manualmente."
    >
      <Field label="Razão social" requirement="required" error={errors.legalName?.message}>
        {(p) => <Input {...p} {...register("legalName")} />}
      </Field>
      <Field label="Nome fantasia" requirement="recommended">
        {(p) => <Input {...p} {...register("tradeName")} />}
      </Field>
      <Field label="CNPJ" requirement="required" error={errors.cnpj?.message}>
        {(p) => <MaskedInput mask="cnpj" placeholder="00.000.000/0000-00" {...p} {...register("cnpj")} />}
      </Field>
      <Field label="Situação cadastral" requirement="recommended">
        {(p) => <Input placeholder="Ex.: Ativa" {...p} {...register("registrationStatus")} />}
      </Field>
      <Field label="Data de abertura" requirement="recommended">
        {(p) => <Input type="date" {...p} {...register("openingDate")} />}
      </Field>
      <Field label="Natureza jurídica" requirement="recommended">
        {(p) => <Input placeholder="Ex.: Sociedade Empresária Limitada" {...p} {...register("legalNature")} />}
      </Field>
      <Field label="CNAE principal" requirement="recommended">
        {(p) => <Input placeholder="0000-0/00 — descrição" {...p} {...register("mainCnae")} />}
      </Field>
      <Field label="CNAEs secundários" requirement="optional" hint="Um por linha.">
        {(p) => <Textarea rows={2} {...p} {...register("secondaryCnaes")} />}
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
      <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
        {(p) => <Input type="email" placeholder="contato@exemplo.com" {...p} {...register("email")} />}
      </Field>
      <Field label="Telefone" requirement="required" error={errors.phone?.message}>
        {(p) => <MaskedInput mask="phone" placeholder="(00) 0000-0000" {...p} {...register("phone")} />}
      </Field>
      <Field label="Site" requirement="optional">
        {(p) => <Input placeholder="www.exemplo.com.br" {...p} {...register("website")} />}
      </Field>
    </FormSection>
  );
}
