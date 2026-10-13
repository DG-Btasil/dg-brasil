"use client";

import { useRouter } from "next/navigation";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { Can } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import { callAction } from "@/lib/actions/result";
import { updateClientAction } from "@/server/domain/clients/actions";
import { useToast } from "@/store/ui-store";
import { useRole } from "@/features/auth/hooks";
import type { Client } from "@/types";
import { companyToValues, individualToValues } from "../../schemas";
import { CLIENT_FIELD_MAP, COMPANY_FIELD_MAP, companyPatch, documentChanged, individualPatch } from "../../server-input";
import { clientShortName } from "../../utils";
import { useClientFormResult } from "./client-create";
import { CompanyForm, IndividualForm } from "./client-forms";
import { CompanyPeopleForm } from "./company-people-form";
import { ClientLifecycleActions } from "./client-lifecycle-actions";

const DOCUMENT_ADMIN_ONLY = "Só o administrador pode corrigir o CPF/CNPJ.";

/** Edição do cadastro (dados vindos do servidor; grava pelo updateClientAction). */
export function ClientEdit({ client }: { client: Client }) {
  const router = useRouter();
  const toast = useToast();
  const role = useRole();
  const handle = useClientFormResult();
  const id = client.id;

  const back = () => router.push(`/clientes/${id}`);

  async function save<V extends FieldValues>(
    patch: Record<string, unknown>,
    setError: UseFormSetError<V>,
    documentField: Path<V>,
    document: string,
    fieldMap: Record<string, string>,
  ) {
    // UX: o servidor recusa de qualquer forma; aqui o aviso aparece no campo.
    if (documentChanged(document, client) && role !== "ADMIN") {
      setError(documentField, { message: DOCUMENT_ADMIN_ONLY }, { shouldFocus: true });
      return;
    }
    const result = await callAction(() => updateClientAction({ id, patch }));
    if (handle(result, setError, { fieldMap, documentField, strip: "patch.", title: "Não foi possível salvar." })) {
      toast({ tone: "success", title: "Cadastro atualizado", description: "As alterações foram salvas." });
      back();
    }
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Clientes", href: "/clientes" },
          { label: clientShortName(client), href: `/clientes/${id}` },
          { label: "Editar cadastro" },
        ]}
        title="Editar cadastro"
        description="Atualize apenas o necessário. Campos opcionais podem ficar em branco."
      />
      {client.kind === "INDIVIDUAL" ? (
        <IndividualForm
          defaultValues={individualToValues(client)}
          submitLabel="Salvar alterações"
          onCancel={back}
          onSubmit={(values, { setError }) => save(individualPatch(values, client), setError, "cpf", values.cpf, CLIENT_FIELD_MAP)}
        />
      ) : (
        <>
          <CompanyForm
            mode="edit"
            defaultValues={companyToValues(client)}
            submitLabel="Salvar alterações"
            onCancel={back}
            onSubmit={(values, { setError }) => save(companyPatch(values, client), setError, "cnpj", values.cnpj, COMPANY_FIELD_MAP)}
          />
          {/* Remonta com os ids reais depois de salvar (o banco avança updated_at). */}
          <Can permission="clients.edit">
            <CompanyPeopleForm key={client.updatedAt} client={client} />
          </Can>
        </>
      )}
      <Can permission="clients.edit">
        <ClientLifecycleActions client={client} />
      </Can>
    </>
  );
}
