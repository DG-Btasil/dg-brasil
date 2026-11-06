"use client";

import { useFormContext, useWatch } from "react-hook-form";
import { autofillHint, useCepAutofill } from "@/features/lookup/use-autofill";
import { Field, FormSection, Input, MaskedInput, Select } from "@/components/ui/form";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import type { AddressFormValues } from "../../schemas";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

/** Bloco de endereço compartilhado por PF e PJ (campo `address`). */
export function AddressFields({ description }: { description?: string }) {
  const {
    register,
    control,
    setValue,
    setFocus,
    formState: { errors },
  } = useFormContext<{ address: AddressFormValues }>();
  const e = errors.address;
  // Roadmap 2.0: o CEP completa logradouro, bairro, município e UF (a pessoa confere e põe o número).
  const zip = useWatch({ control, name: "address.zipCode" });
  const cepStatus = useCepAutofill(zip, (a) => {
    const opts = { shouldValidate: true, shouldDirty: true } as const;
    if (a.street) setValue("address.street", a.street, opts);
    if (a.district) setValue("address.district", a.district, opts);
    if (a.city) setValue("address.city", a.city, opts);
    if (a.state) setValue("address.state", a.state, opts);
    setTimeout(() => setFocus("address.number"), 0);
  });
  return (
    <FormSection title="Endereço" description={description ?? "Endereço completo, para a qualificação em peças e correspondências."}>
      <Field label="CEP" requirement="required" error={e?.zipCode?.message} hint={autofillHint(cepStatus, "CEP") ?? "Digite o CEP: o endereço é preenchido sozinho."}>
        {(p) => <MaskedInput mask="cep" placeholder="00000-000" {...p} {...register("address.zipCode")} />}
      </Field>
      <Field label="Logradouro" requirement="required" error={e?.street?.message}>
        {(p) => <Input {...p} {...register("address.street")} />}
      </Field>
      <div className="grid grid-cols-[1fr_1.4fr] gap-x-5">
        <Field label="Número" requirement="required" error={e?.number?.message}>
          {(p) => <Input {...p} {...register("address.number")} />}
        </Field>
        <Field label="Complemento" requirement="optional">
          {(p) => <Input {...p} {...register("address.complement")} />}
        </Field>
      </div>
      <Field label="Bairro" requirement="required" error={e?.district?.message}>
        {(p) => <Input {...p} {...register("address.district")} />}
      </Field>
      <Field label="Município" requirement="required" error={e?.city?.message}>
        {(p) => <Input {...p} {...register("address.city")} />}
      </Field>
      <div className="grid grid-cols-[1fr_1.4fr] gap-x-5">
        <Field label="UF" requirement="required" error={e?.state?.message}>
          {(p) => <Select placeholder="—" options={UF_OPTIONS} {...p} {...register("address.state")} />}
        </Field>
        <Field label="País" requirement="optional">
          {(p) => <Input {...p} {...register("address.country")} />}
        </Field>
      </div>
    </FormSection>
  );
}
