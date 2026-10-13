import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { ClientNotFound } from "@/features/clients/components/detail/client-not-found";
import { ClientEdit } from "@/features/clients/components/form/client-edit";
import { getClientAction } from "@/server/domain/clients/actions";

async function EditClient({ id }: { id: string }) {
  const result = await getClientAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <ClientNotFound />;
    return <ActionErrorState error={result} title="Não foi possível abrir o cadastro." />;
  }
  if (result.data.surface !== "INTERNAL") return <ClientNotFound />;
  return <ClientEdit client={result.data.client} />;
}

export default async function EditClientPage({ params }: PageProps<"/clientes/[id]/editar">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="clients.edit">
        <EditClient id={id} />
      </RequirePermission>
    </PageContainer>
  );
}
