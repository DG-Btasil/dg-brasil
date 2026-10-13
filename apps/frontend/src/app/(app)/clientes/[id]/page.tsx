import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { ClientDetail } from "@/features/clients/components/detail/client-detail";
import { ClientNotFound } from "@/features/clients/components/detail/client-not-found";
import { PortalClientDetail } from "@/features/partner-portal/components/portal-clients";
import { listCasesAction } from "@/server/domain/cases/actions";
import { getClientAction } from "@/server/domain/clients/actions";
import { listProcessesAction } from "@/server/domain/processes/actions";

/**
 * Ficha do cliente, lida no servidor a cada acesso (rota direta, nova aba e
 * recarregar funcionam). Sem acesso, id inexistente ou malformado → "não
 * encontrado": a tela nunca diz se o cliente existe em outro escritório.
 */
async function InternalClient({ id }: { id: string }) {
  const result = await getClientAction({ id });
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <ClientNotFound />;
    return <ActionErrorState error={result} title="Não foi possível abrir o cliente." />;
  }
  if (result.data.surface !== "INTERNAL") return <ClientNotFound />;
  const [cases, processes] = await Promise.all([
    listCasesAction({ clientId: id, pageSize: 50 }),
    listProcessesAction({ clientId: id, pageSize: 50 }),
  ]);
  return (
    <Suspense fallback={<SkeletonRows rows={6} />}>
      <ClientDetail client={result.data.client} cases={cases} processes={processes} />
    </Suspense>
  );
}

export default async function ClientPage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  // Parceiro: cliente sem vínculo não existe no estado recortado e aparece como "não encontrado".
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="clients.view">
            <InternalClient id={id} />
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalClientDetail id={id} />
        </RequirePermission>
      }
    />
  );
}
