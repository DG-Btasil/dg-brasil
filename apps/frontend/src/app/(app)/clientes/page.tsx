import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ClientList } from "@/features/clients/components/list/client-list";
import { clientQueryFromSearchParams, clientQueryToInput } from "@/features/clients/list-query";
import { PortalClientList } from "@/features/partner-portal/components/portal-clients";
import { listClientsAction } from "@/server/domain/clients/actions";

/** Primeira página carregada no servidor, já com os filtros da URL. */
async function InternalClientList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = clientQueryFromSearchParams(searchParams);
  const result = await listClientsAction(clientQueryToInput(query));
  return <ClientList initialQuery={query} initialResult={result} />;
}

export default async function ClientsPage({ searchParams }: PageProps<"/clientes">) {
  const params = await searchParams;
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="clients.view">
            <InternalClientList searchParams={params} />
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalClientList />
        </RequirePermission>
      }
    />
  );
}
