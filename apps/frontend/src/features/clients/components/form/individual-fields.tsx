"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { Field, FormSection, Input, MaskedInput, Select } from "@/components/ui/form";
import {
  BRAZILIAN_STATES,
  GENDER_LABEL,
  GENDER_NOT_INFORMED,
  GENDERS,
  ID_DOCUMENT_TYPES,
  ID_DOCUMENT_TYPE_LABEL,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABEL,
} from "@/lib/constants/legal";
import type { IndividualFormValues } from "../../schemas";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));
const ID_OPTIONS = ID_DOCUMENT_TYPES.map((t) => ({ value: t, label: ID_DOCUMENT_TYPE_LABEL[t] }));
const MARITAL_OPTIONS = MARITAL_STATUSES.map((m) => ({ value: m, label: MARITAL_STATUS_LABEL[m] }));
const GENDER_OPTIONS = GENDERS.map((g) => ({ value: g, label: GENDER_LABEL[g] }));

export function IndividualIdentificationFields() {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<IndividualFormValues>();
  const marital = useWatch({ control, name: "maritalStatus" });
  return (
    <FormSection title="Identificação" description="Somente o essencial é obrigatório. Os dados recomendados agilizam a qualificação nas peças.">
      <Field label="Nome completo" requirement="required" error={errors.fullName?.message}>
        {(p) => <Input autoComplete="off" {...p} {...register("fullName")} />}
      </Field>
      <Field label="Nome social" requirement="optional" hint="Usado no tratamento com o cliente.">
        {(p) => <Input {...p} {...register("socialName")} />}
      </Field>
      <Field label="CPF" requirement="required" error={errors.cpf?.message}>
        {(p) => <MaskedInput mask="cpf" placeholder="000.000.000-00" {...p} {...register("cpf")} />}
      </Field>
      <Field label="Data de nascimento" requirement="recommended">
        {(p) => <Input type="date" {...p} {...register("birthDate")} />}
      </Field>
      <div className="col-span-2 grid grid-cols-[1fr_1.3fr_1fr_0.7fr] gap-x-5">
        <Field label="Documento de identidade" requirement="recommended">
          {(p) => <Select placeholder="Tipo" options={ID_OPTIONS} {...p} {...register("idType")} />}
        </Field>
        <Field label="Número do documento" requirement="recommended">
          {(p) => <Input placeholder="00.000.000-0" {...p} {...register("idNumber")} />}
        </Field>
        <Field label="Órgão emissor" requirement="recommended">
          {(p) => <Input placeholder="SSP" {...p} {...register("idIssuer")} />}
        </Field>
        <Field label="UF" requirement="recommended">
          {(p) => <Select placeholder="—" options={UF_OPTIONS} {...p} {...register("idState")} />}
        </Field>
      </div>
      <Field label="Nacionalidade" requirement="recommended">
        {(p) => <Input {...p} {...register("nationality")} />}
      </Field>
      <Field label="Naturalidade" requirement="optional" hint="Município/UF de nascimento.">
        {(p) => <Input {...p} {...register("birthplace")} />}
      </Field>
      <Field label="Estado civil" requirement="recommended">
        {(p) => <Select placeholder="Selecione" options={MARITAL_OPTIONS} {...p} {...register("maritalStatus")} />}
      </Field>
      {marital !== "MARRIED" ? (
        <Field label="União estável" requirement="optional">
          {(p) => (
            <Select
              placeholder="Não informado"
              options={[
                { value: "yes", label: "Sim" },
                { value: "no", label: "Não" },
              ]}
              {...p}
              {...register("stableUnion")}
            />
          )}
        </Field>
      ) : (
        <div />
      )}
      <Field label="Profissão" requirement="recommended">
        {(p) => <Input {...p} {...register("profession")} />}
      </Field>
      <Field label="Gênero" requirement="optional">
        {(p) => <Select placeholder={GENDER_NOT_INFORMED} options={GENDER_OPTIONS} {...p} {...register("gender")} />}
      </Field>
    </FormSection>
  );
}

export function IndividualContactFields() {
  const {
    register,
    formState: { errors },
  } = useFormContext<IndividualFormValues>();
  return (
    <FormSection title="Contato">
      <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
        {(p) => <Input type="email" placeholder="nome@exemplo.com" {...p} {...register("email")} />}
      </Field>
      <Field label="Telefone principal" requirement="required" error={errors.phone?.message}>
        {(p) => <MaskedInput mask="phone" placeholder="(00) 00000-0000" {...p} {...register("phone")} />}
      </Field>
      <Field label="Telefone secundário / WhatsApp" requirement="optional" error={errors.secondaryPhone?.message}>
        {(p) => <MaskedInput mask="phone" placeholder="(00) 00000-0000" {...p} {...register("secondaryPhone")} />}
      </Field>
    </FormSection>
  );
}
