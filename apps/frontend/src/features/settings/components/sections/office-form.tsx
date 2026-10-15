"use client";

import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Field, FormSection, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import type { Office } from "@/types";
import { callAction, mapFieldErrors } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { updateOwnerOfficeAction } from "@/server/domain/organizations/actions";
import { useToast } from "@/store/ui-store";
import { officePatchToServer } from "../../office-input";
import { officeSchema, officeToForm, type OfficeFormOutput, type OfficeFormValues } from "../../schemas";

const UF_OPTIONS = BRAZILIAN_STATES.map((s) => ({ value: s, label: s }));

/** Dados do escritório (updateOwnerOfficeAction, ADMIN). A tela atualiza depois da resposta. */
export function OfficeForm({ office, onSaved }: { office: Office; onSaved: () => void }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OfficeFormValues, unknown, OfficeFormOutput>({ resolver: zodResolver(officeSchema), defaultValues: officeToForm(office) });

  async function onSubmit(values: OfficeFormOutput) {
    const result = await callAction(() => updateOwnerOfficeAction(officePatchToServer(values)));
    if (!result.ok) {
      const fields = mapFieldErrors(result.error.fieldErrors, { "address.zipCode": "zipCode", "address.state": "state", "oab.number": "oab", "oab.state": "oab" });
      for (const [path, message] of Object.entries(fields)) setError(path as keyof OfficeFormValues, { message });
      if (Object.keys(fields).length === 0) failed(result, "Não foi possível salvar os dados do escritório.");
      return;
    }
    toast({ tone: "success", title: "Dados do escritório salvos" });
    reset(values);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormSection title="Identificação" description="Como o escritório aparece nos documentos e na interface.">
        <Field label="Nome do escritório" requirement="required" error={errors.name?.message}>
          {(p) => <Input {...p} {...register("name")} />}
        </Field>
        <Field label="Razão social" requirement="recommended">
          {(p) => <Input {...p} {...register("legalName")} />}
        </Field>
        <Field label="CNPJ" requirement="recommended" error={errors.cnpj?.message}>
          {(p) => <MaskedInput {...p} mask="cnpj" placeholder="00.000.000/0000-00" {...register("cnpj")} />}
        </Field>
        <Field label="OAB da sociedade ou do titular" requirement="optional" error={errors.oab?.message}>
          {(p) => <MaskedInput {...p} mask="oab" placeholder="OAB/UF 000.000" {...register("oab")} />}
        </Field>
        <Field label="Advogado(a) responsável" requirement="required" error={errors.principalLawyer?.message}>
          {(p) => <Input {...p} {...register("principalLawyer")} />}
        </Field>
      </FormSection>

      <FormSection title="Contato" description="Canais institucionais do escritório.">
        <Field label="E-mail" requirement="recommended" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" {...register("email")} />}
        </Field>
        <Field label="Telefone" requirement="recommended" error={errors.phone?.message}>
          {(p) => <MaskedInput {...p} mask="phone" placeholder="(00) 0000-0000" {...register("phone")} />}
        </Field>
        <Field label="Site" requirement="optional">
          {(p) => <Input {...p} {...register("website")} />}
        </Field>
      </FormSection>

      <FormSection title="Endereço" description="Sede do escritório.">
        <Field label="CEP" requirement="optional" error={errors.zipCode?.message}>
          {(p) => <MaskedInput {...p} mask="cep" placeholder="00000-000" {...register("zipCode")} />}
        </Field>
        <Field label="Logradouro" requirement="optional">
          {(p) => <Input {...p} {...register("street")} />}
        </Field>
        <Field label="Número" requirement="optional">
          {(p) => <Input {...p} {...register("number")} />}
        </Field>
        <Field label="Complemento" requirement="optional">
          {(p) => <Input {...p} {...register("complement")} />}
        </Field>
        <Field label="Bairro" requirement="optional">
          {(p) => <Input {...p} {...register("district")} />}
        </Field>
        <Field label="Cidade" requirement="optional">
          {(p) => <Input {...p} {...register("city")} />}
        </Field>
        <Field label="UF" requirement="optional">
          {(p) => <Select {...p} placeholder="Selecione" options={UF_OPTIONS} {...register("state")} />}
        </Field>
      </FormSection>

      <FormSection title="Atuação" description="Estados em que o escritório atua e unidades.">
        <Controller
          control={control}
          name="statesOfPractice"
          render={({ field }) => (
            <fieldset className="col-span-2">
              <legend className="mb-2 text-[12.5px] font-medium text-foreground">Estados de atuação</legend>
              <div className="flex flex-wrap gap-1.5">
                {BRAZILIAN_STATES.map((uf) => {
                  const checked = field.value.includes(uf);
                  return (
                    <label
                      key={uf}
                      className={cn(
                        "inline-flex h-8 w-11 cursor-pointer items-center justify-center rounded-md border text-[12px] font-medium tabular transition-colors focus-within:ring-2 focus-within:ring-gold/40",
                        checked ? "border-navy bg-navy text-white" : "border-line-strong bg-surface text-muted hover:border-navy-600/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() => field.onChange(checked ? field.value.filter((v) => v !== uf) : [...field.value, uf])}
                      />
                      {uf}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        />
        <Field label="Unidades" requirement="optional" hint="Uma unidade por linha." className="col-span-2">
          {(p) => <Textarea {...p} rows={3} {...register("units")} />}
        </Field>
      </FormSection>

      <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" disabled={!isDirty} onClick={() => reset(officeToForm(office))}>
          Descartar alterações
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          Salvar dados do escritório
        </Button>
      </div>
    </form>
  );
}
