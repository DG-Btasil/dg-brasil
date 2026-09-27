"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/display";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import { useClient } from "../../hooks";
import { companyToInput, companyToValues, individualToInput, individualToValues } from "../../schemas";
import { clientShortName } from "../../utils";
import { ClientNotFound } from "../detail/client-not-found";
import { CompanyForm, IndividualForm } from "./client-forms";

export function ClientEdit({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const client = useClient(id);
  if (!client) return <ClientNotFound />;

  const back = () => router.push(`/clientes/${id}`);
  async function done() {
    toast({ tone: "success", title: "Cadastro atualizado", description: "As alterações foram salvas." });
    back();
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
          onSubmit={async (values) => {
            await repositories.clients.update(id, individualToInput(values));
            await done();
          }}
        />
      ) : (
        <CompanyForm
          defaultValues={companyToValues(client)}
          submitLabel="Salvar alterações"
          onCancel={back}
          onSubmit={async (values) => {
            await repositories.clients.update(id, companyToInput(values));
            await done();
          }}
        />
      )}
    </>
  );
}
