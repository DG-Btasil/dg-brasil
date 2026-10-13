"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRef, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormSetError } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { companySchema, individualSchema, type CompanyFormValues, type IndividualFormValues } from "../../schemas";
import { AddressFields } from "./address-fields";
import { CompanyContactFields, CompanyDataFields } from "./company-fields";
import { IndividualContactFields, IndividualIdentificationFields } from "./individual-fields";
import { InternalFields } from "./internal-fields";
import { PartnersFields } from "./partners-fields";
import { RepresentativesFields } from "./representatives-fields";

/** O formulário entrega `setError` para os erros de campo vindos do servidor. */
export type ClientFormSubmit<V extends FieldValues> = (values: V, helpers: { setError: UseFormSetError<V> }) => Promise<void>;

interface FormProps<V extends FieldValues> {
  defaultValues: V;
  submitLabel: string;
  onSubmit: ClientFormSubmit<V>;
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
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
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

/** Um envio por vez: o segundo clique durante o envio é ignorado (além do botão desabilitado). */
export function useSingleSubmit<V extends FieldValues>(onSubmit: ClientFormSubmit<V>, setError: UseFormSetError<V>) {
  const busy = useRef(false);
  return async (values: V) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await onSubmit(values, { setError });
    } finally {
      busy.current = false;
    }
  };
}

export function IndividualForm({ defaultValues, submitLabel, onSubmit, onCancel }: FormProps<IndividualFormValues>) {
  const methods = useForm<IndividualFormValues>({ resolver: zodResolver(individualSchema), defaultValues, shouldFocusError: true });
  const submit = useSingleSubmit(onSubmit, methods.setError);
  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={methods.handleSubmit(submit)} aria-label="Cadastro de pessoa física">
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

/** Na edição, representantes e sócios ficam fora deste formulário (gravação atômica própria). */
const companyEditSchema = companySchema.extend({ representatives: z.array(z.any()), partners: z.array(z.any()) });

export function CompanyForm({ defaultValues, submitLabel, onSubmit, onCancel, mode = "create" }: FormProps<CompanyFormValues> & { mode?: "create" | "edit" }) {
  const methods = useForm<CompanyFormValues>({
    resolver: zodResolver(mode === "edit" ? (companyEditSchema as unknown as typeof companySchema) : companySchema),
    defaultValues,
    shouldFocusError: true,
  });
  const submit = useSingleSubmit(onSubmit, methods.setError);
  return (
    <FormProvider {...methods}>
      <form noValidate onSubmit={methods.handleSubmit(submit)} aria-label="Cadastro de pessoa jurídica">
        <FormFrame>
          <CompanyDataFields />
          <CompanyContactFields />
          <AddressFields description="Endereço da sede. Recomendado para qualificação e citações." />
          {/* Na edição, representantes e sócios têm formulário próprio (CompanyPeopleForm). */}
          {mode === "create" && (
            <>
              <RepresentativesFields />
              <PartnersFields />
            </>
          )}
          <InternalFields />
          <StickyFooter submitLabel={submitLabel} submitting={methods.formState.isSubmitting} onCancel={onCancel} />
        </FormFrame>
      </form>
    </FormProvider>
  );
}
