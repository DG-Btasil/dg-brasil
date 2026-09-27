"use client";

import { useFormContext } from "react-hook-form";
import { Field, FormSection, Input, MaskedInput, Select } from "@/components/ui/form";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import type { AddressFormValues } from "../../schemas";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

/** Bloco de endereço compartilhado por PF e PJ (campo `address`). */
export function AddressFields({ description }: { description?: string }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<{ address: AddressFormValues }>();
  const e = errors.address;
  return (
    <FormSection title="Endereço" description={description ?? "Recomendado para qualificação em peças e correspondências."}>
      <Field label="CEP" requirement="recommended" error={e?.zipCode?.message}>
        {(p) => <MaskedInput mask="cep" placeholder="00000-000" {...p} {...register("address.zipCode")} />}
      </Field>
      <Field label="Logradouro" requirement="recommended">
        {(p) => <Input {...p} {...register("address.street")} />}
      </Field>
      <div className="grid grid-cols-[1fr_1.4fr] gap-x-5">
        <Field label="Número" requirement="recommended">
          {(p) => <Input {...p} {...register("address.number")} />}
        </Field>
        <Field label="Complemento" requirement="optional">
          {(p) => <Input {...p} {...register("address.complement")} />}
        </Field>
      </div>
      <Field label="Bairro" requirement="recommended">
        {(p) => <Input {...p} {...register("address.district")} />}
      </Field>
      <Field label="Município" requirement="recommended">
        {(p) => <Input {...p} {...register("address.city")} />}
      </Field>
      <div className="grid grid-cols-[1fr_1.4fr] gap-x-5">
        <Field label="UF" requirement="recommended">
          {(p) => <Select placeholder="—" options={UF_OPTIONS} {...p} {...register("address.state")} />}
        </Field>
        <Field label="País" requirement="recommended">
          {(p) => <Input {...p} {...register("address.country")} />}
        </Field>
      </div>
    </FormSection>
  );
}
