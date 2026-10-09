import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ClientEdit } from "@/features/clients/components/form/client-edit";

export default async function EditClientPage({ params }: PageProps<"/clientes/[id]/editar">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="clients.edit">
        <ClientEdit id={id} />
      </RequirePermission>
    </PageContainer>
  );
}
