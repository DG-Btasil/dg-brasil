"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/display";
import { repositories } from "@/repositories";
import { useToast } from "@/store/ui-store";
import { useClient, useDefaultClientOrigin } from "../../hooks";
import { companyToInput, companyToValues, individualToInput, individualToValues } from "../../schemas";
import { clientShortName } from "../../utils";
import { ClientNotFound } from "../detail/client-not-found";
import { CompanyForm, IndividualForm } from "./client-forms";
import { ClientLifecycleActions } from "./client-lifecycle-actions";
import { Can } from "@/components/layout/guards";

export function ClientEdit({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const client = useClient(id);
  const defaultOrigin = useDefaultClientOrigin();
  if (!client) return <ClientNotFound />;

  const back = () => router.push(`/clientes/${id}`);
  async function save(run: () => Promise<void>) {
    try {
      await run();
      await done();
    } catch (error) {
      toast({ tone: "danger", title: "Não foi possível salvar.", description: error instanceof Error ? error.message : undefined });
    }
  }
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
          defaultValues={{ ...individualToValues(client), originOfficeId: client.originOfficeId ?? defaultOrigin }}
          submitLabel="Salvar alterações"
          onCancel={back}
          onSubmit={(values) => save(() => repositories.clients.update(id, individualToInput(values)))}
        />
      ) : (
        <CompanyForm
          defaultValues={{ ...companyToValues(client), originOfficeId: client.originOfficeId ?? defaultOrigin }}
          submitLabel="Salvar alterações"
          onCancel={back}
          onSubmit={(values) => save(() => repositories.clients.update(id, companyToInput(values)))}
        />
      )}
      <Can permission="clients.edit">
        <ClientLifecycleActions client={client} />
      </Can>
    </>
  );
}
