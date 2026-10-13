"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { Building2, UserRound } from "lucide-react";
import { ChoiceCards } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/display";
import { CLIENT_KIND_LABEL, type ClientKind } from "@/lib/constants/status";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { createClientAction } from "@/server/domain/clients/actions";
import { useToast } from "@/store/ui-store";
import { useClientSession } from "@/features/auth/session-context";
import { useDefaultOrigin } from "@/features/directory/directory-context";
import { emptyCompanyValues, emptyIndividualValues } from "../../schemas";
import { CLIENT_FIELD_MAP, COMPANY_FIELD_MAP, companyCreateInput, individualCreateInput } from "../../server-input";
import { CompanyForm, IndividualForm } from "./client-forms";

/**
 * Resposta de uma action de cliente no formulário: erro de campo vai para o
 * campo; CPF/CNPJ já cadastrado aparece no próprio campo do documento; o
 * resto vira aviso com código de referência. Devolve true no sucesso.
 */
export function useClientFormResult() {
  const failed = useActionFeedback();
  return function handle<V extends FieldValues, T>(
    result: ActionResult<T>,
    setError: UseFormSetError<V>,
    options: { fieldMap: Record<string, string>; documentField: Path<V>; strip?: string; title: string },
  ): result is Extract<ActionResult<T>, { ok: true }> {
    if (result.ok) return true;
    if (result.error.code === "DUPLICATE_CLIENT") {
      setError(options.documentField, { message: result.error.message }, { shouldFocus: true });
      return false;
    }
    const fields = mapFieldErrors(result.error.fieldErrors, options.fieldMap, options.strip);
    Object.entries(fields).forEach(([name, message], i) => setError(name as Path<V>, { message }, { shouldFocus: i === 0 }));
    failed(result, options.title);
    return false;
  };
}

export function ClientCreate() {
  const router = useRouter();
  const toast = useToast();
  const session = useClientSession();
  const handle = useClientFormResult();
  const [kind, setKind] = useState<ClientKind | undefined>(undefined);
  // Origem já vem preenchida com o escritório do usuário; responsável, com o próprio usuário.
  const defaultOrigin = useDefaultOrigin();

  function finish(id: string, name: string) {
    toast({ tone: "success", title: "Cliente cadastrado", description: `${name} foi adicionado à carteira do escritório.` });
    // Navega para o recurso devolvido pelo servidor (id do banco).
    router.push(`/clientes/${id}`);
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Novo cliente" }]}
        title="Cadastrar cliente"
        description="Comece pelo tipo de pessoa. Informe o essencial agora — dados recomendados e opcionais podem ser completados depois."
      />
      <div className="mb-6 max-w-[760px]">
        <p aria-hidden className="mb-2 text-[12.5px] font-medium text-foreground">
          Tipo de cliente
        </p>
        <ChoiceCards<ClientKind>
          name="client-kind"
          legend="Tipo de cliente"
          value={kind}
          onChange={setKind}
          options={[
            {
              value: "INDIVIDUAL",
              label: CLIENT_KIND_LABEL.INDIVIDUAL,
              description: "Identificação por CPF. Qualificação civil e contato.",
              icon: <UserRound className="size-5" aria-hidden />,
            },
            {
              value: "COMPANY",
              label: CLIENT_KIND_LABEL.COMPANY,
              description: "Identificação por CNPJ. Representantes legais e quadro societário.",
              icon: <Building2 className="size-5" aria-hidden />,
            },
          ]}
        />
      </div>
      {kind === "INDIVIDUAL" && (
        <IndividualForm
          key="pf"
          defaultValues={emptyIndividualValues(session?.userId, defaultOrigin)}
          submitLabel="Cadastrar cliente"
          onCancel={() => router.push("/clientes")}
          onSubmit={async (values, { setError }) => {
            const result = await callAction(() => createClientAction(individualCreateInput(values)));
            if (handle(result, setError, { fieldMap: CLIENT_FIELD_MAP, documentField: "cpf", title: "Não foi possível cadastrar o cliente." })) {
              finish(result.data.id, values.fullName);
            }
          }}
        />
      )}
      {kind === "COMPANY" && (
        <CompanyForm
          key="pj"
          defaultValues={emptyCompanyValues(session?.userId, defaultOrigin)}
          submitLabel="Cadastrar cliente"
          onCancel={() => router.push("/clientes")}
          onSubmit={async (values, { setError }) => {
            const result = await callAction(() => createClientAction(companyCreateInput(values)));
            if (handle(result, setError, { fieldMap: COMPANY_FIELD_MAP, documentField: "cnpj", title: "Não foi possível cadastrar o cliente." })) {
              finish(result.data.id, values.tradeName || values.legalName);
            }
          }}
        />
      )}
      {!kind && <p className="text-[12.5px] text-muted">Selecione Pessoa Física ou Pessoa Jurídica para exibir o formulário correspondente.</p>}
    </>
  );
}
