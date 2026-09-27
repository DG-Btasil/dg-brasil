"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { companySchema, individualSchema, type CompanyFormValues, type IndividualFormValues } from "../../schemas";
import { AddressFields } from "./address-fields";
import { CompanyContactFields, CompanyDataFields } from "./company-fields";
import { IndividualContactFields, IndividualIdentificationFields } from "./individual-fields";
import { InternalFields } from "./internal-fields";
import { PartnersFields } from "./partners-fields";
import { RepresentativesFields } from "./representatives-fields";

interface FormProps<V> {
  defaultValues: V;
  submitLabel: string;
  onSubmit: (values: V) => Promise<void>;
  onCancel: () => void;
}

function StickyFooter({ submitLabel, submitting, onCancel }: { submitLabel: string; submitting: boolean; onCancel: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-6 mt-2 flex items-center justify-between gap-3 rounded-b-lg border-t border-line bg-surface px-6 py-3.5 shadow-hairline">
      <p className="text-[12px] text-muted">
        <span className="text-danger" aria-hidden>
          *
        </span>{" "}
        Campos obrigatórios. Dados opcionais podem ser completados depois.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function FormFrame({ children }: { children: ReactNode }) {
  return <Panel className="px-6">{children}</Panel>;
}

export function IndividualForm({ defaultValues, submitLabel, onSubmit, onCancel }: FormProps<IndividualFormValues>) {
  const methods = useForm<IndividualFormValues>({ resolver: zodResolver(individualSchema), defaultValues, shouldFocusError: true });
  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={methods.handleSubmit(onSubmit)} aria-label="Cadastro de pessoa física">
        <FormFrame>
          <IndividualIdentificationFields />
          <IndividualContactFields />
          <AddressFields />
          <InternalFields />
          <StickyFooter submitLabel={submitLabel} submitting={methods.formState.isSubmitting} onCancel={onCancel} />
        </FormFrame>
      </form>
    </FormProvider>
  );
}

export function CompanyForm({ defaultValues, submitLabel, onSubmit, onCancel }: FormProps<CompanyFormValues>) {
  const methods = useForm<CompanyFormValues>({ resolver: zodResolver(companySchema), defaultValues, shouldFocusError: true });
  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={methods.handleSubmit(onSubmit)} aria-label="Cadastro de pessoa jurídica">
        <FormFrame>
          <CompanyDataFields />
          <CompanyContactFields />
          <AddressFields description="Endereço da sede. Recomendado para qualificação e citações." />
          <RepresentativesFields />
          <PartnersFields />
          <InternalFields />
          <StickyFooter submitLabel={submitLabel} submitting={methods.formState.isSubmitting} onCancel={onCancel} />
        </FormFrame>
      </form>
    </FormProvider>
  );
}
