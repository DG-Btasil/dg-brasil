"use client";

import { useRouter } from "next/navigation";
import { FormProvider, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/display";
import { Field, FormSection, Input, MaskedInput, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { AddressFields } from "@/features/clients/components/form/address-fields";
import type { Path, UseFormSetError } from "react-hook-form";
import { mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import type { PartnerOfficeAdminDTO } from "@/server/domain/organizations/dto";
import { usePartnerOfficeActions } from "../use-partner-office-actions";
import { PARTNER_FIELD_MAP, partnerCreateInput, partnerPatch } from "../server-input";
import {
  EMPTY_PARTNER_VALUES,
  partnerCreateSchema,
  partnerDataSchema,
  partnerToDataValues,
  type PartnerCreateValues,
  type PartnerDataValues,
} from "../schemas";
import { ShareFields } from "./share-fields";

const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf, label: uf }));

/** Campos cadastrais comuns ao cadastro e à edição. */
function PartnerDataSections({ form }: { form: UseFormReturn<PartnerDataValues> | UseFormReturn<PartnerCreateValues> }) {
  const f = form as UseFormReturn<PartnerDataValues>;
  const {
    register,
    formState: { errors },
  } = f;
  return (
    <>
      <FormSection title="Escritório" description="Identificação do escritório parceiro.">
        <Field label="Nome do escritório" requirement="required" error={errors.name?.message}>
          {(p) => <Input {...p} placeholder="Ex.: Almeida Advocacia" {...register("name")} />}
        </Field>
        <Field label="Razão social" requirement="optional">
          {(p) => <Input {...p} {...register("legalName")} />}
        </Field>
        <Field label="CNPJ" requirement="optional" error={errors.cnpj?.message}>
          {(p) => <MaskedInput mask="cnpj" placeholder="00.000.000/0000-00" {...p} {...register("cnpj")} />}
        </Field>
      </FormSection>
      <FormSection title="Responsável principal" description="Advogado(a) responsável pela parceria (contato operacional).">
        <Field label="Nome" requirement="required" error={errors.responsibleName?.message}>
          {(p) => <Input {...p} {...register("responsibleName")} />}
        </Field>
        <div className="grid grid-cols-[1.4fr_1fr] gap-x-5">
          <Field label="OAB" requirement="required" error={errors.responsibleOab?.message}>
            {(p) => <MaskedInput mask="oab" placeholder="000.000" {...p} {...register("responsibleOab")} />}
          </Field>
          <Field label="UF da OAB" requirement="required" error={errors.oabState?.message}>
            {(p) => <Select placeholder="—" options={UF_OPTIONS} {...p} {...register("oabState")} />}
          </Field>
        </div>
        <Field label="E-mail" requirement="required" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" {...register("email")} />}
        </Field>
        <Field label="Telefone" requirement="required" error={errors.phone?.message}>
          {(p) => <MaskedInput mask="phone" placeholder="(00) 00000-0000" {...p} {...register("phone")} />}
        </Field>
      </FormSection>
      <AddressFields description="Endereço do escritório parceiro." />
      <FormSection title="Observações" description="Uso interno. Nunca são exibidas ao parceiro.">
        <Field label="Observações internas" requirement="optional" className="col-span-full">
          {(p) => <Textarea {...p} rows={3} {...register("notes")} />}
        </Field>
      </FormSection>
    </>
  );
}

/** Erros de campo do servidor → campos do formulário de parceiro. */
function applyErrors<V extends PartnerDataValues>(result: ActionResult<unknown>, setError: UseFormSetError<V>, strip?: string) {
  if (result.ok) return;
  Object.entries(mapFieldErrors(result.error.fieldErrors, PARTNER_FIELD_MAP, strip)).forEach(([name, message], i) =>
    setError(name as Path<V>, { message }, { shouldFocus: i === 0 }),
  );
}

/** Página: Parceiros → Adicionar parceiro. */
export function PartnerCreate() {
  const router = useRouter();
  const actions = usePartnerOfficeActions();
  const form = useForm<PartnerCreateValues>({ resolver: zodResolver(partnerCreateSchema), defaultValues: EMPTY_PARTNER_VALUES });

  const onSubmit = form.handleSubmit(async (values) => {
    const result = await actions.create(partnerCreateInput(values));
    if (result.ok) router.push(`/parceiros/${result.data.id}`);
    else applyErrors(result, form.setError);
  });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Parceiros", href: "/parceiros" }, { label: "Adicionar parceiro" }]}
        title="Adicionar parceiro"
        description="Cadastre o escritório parceiro e a divisão padrão da parceria. Depois, convide o responsável em Configurações → Equipe, escolhendo o escritório."
      />
      <FormProvider {...form}>
        <form onSubmit={onSubmit} noValidate>
          <Panel className="px-7">
            <PartnerDataSections form={form} />
            <FormSection
              title="Parceria financeira"
              description="Divisão padrão dos honorários de NOVOS casos deste parceiro. Não precisa ser 50/50."
            >
              <ShareFields partnerField="partnershipPercentage" ownerField="ownerPercentage" />
              <Callout tone="info" className="col-span-full">
                Quando um caso passa a ter acordo financeiro, esta divisão é copiada para o caso. Alterações futuras valem apenas para casos
                novos — os acordos já existentes não são recalculados.
              </Callout>
            </FormSection>
          </Panel>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => router.push("/parceiros")}>
              Cancelar
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              Cadastrar parceiro
            </Button>
          </div>
        </form>
      </FormProvider>
    </>
  );
}

/** Edição dos dados cadastrais (a divisão tem fluxo próprio). */
export function PartnerEditDrawer({ partner, open, onOpenChange }: { partner: PartnerOfficeAdminDTO; open: boolean; onOpenChange: (open: boolean) => void }) {
  const actions = usePartnerOfficeActions();
  const form = useForm<PartnerDataValues>({ resolver: zodResolver(partnerDataSchema), defaultValues: partnerToDataValues(partner) });
  const onSubmit = form.handleSubmit(async (values) => {
    const result = await actions.update(partner.id, partnerPatch(values));
    if (result.ok) onOpenChange(false);
    else applyErrors(result, form.setError, "patch.");
  });
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      width={760}
      title="Editar dados do parceiro"
      description="A divisão da parceria é alterada separadamente, na Visão Geral."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <FormProvider {...form}>
        <form onSubmit={onSubmit} noValidate className="-my-7 [&_section]:grid-cols-1 [&_section]:gap-4">
          <PartnerDataSections form={form} />
        </form>
      </FormProvider>
    </Drawer>
  );
}
