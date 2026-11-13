import { MetricsBoard } from "@/features/metrics/components/metrics-board";
import { getDashboardMetricsAction } from "@/server/domain/metrics/actions";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ClientList } from "@/features/clients/components/list/client-list";
import { clientQueryFromSearchParams, clientQueryToInput } from "@/features/clients/list-query";
import { PortalClientList } from "@/features/partner-portal/components/portal-clients";
import { portalClientInput, portalQueryFromSearchParams } from "@/features/partner-portal/list-query";
import { listClientsAction } from "@/server/domain/clients/actions";

/** A exportação de planilha (até 5.000 linhas) roda como Server Action desta rota. */
export const maxDuration = 60;

/** Primeira página carregada no servidor, já com os filtros da URL. */
async function InternalClientList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = clientQueryFromSearchParams(searchParams);
  const [result, metrics] = await Promise.all([listClientsAction(clientQueryToInput(query)), getDashboardMetricsAction({ period: "30" })]);
  return <ClientList initialQuery={query} initialResult={result} insights={<MetricsBoard variant="clients" initial={metrics} />} />;
}

/** Portal: primeira página dos clientes do próprio escritório (RLS). */
async function PartnerClientList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = portalQueryFromSearchParams(searchParams);
  const [result, metrics] = await Promise.all([listClientsAction(portalClientInput(query)), getDashboardMetricsAction({ period: "30" })]);
  return <PortalClientList initialQuery={query} initialResult={result} insights={<MetricsBoard variant="clients" initial={metrics} />} />;
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
          <PartnerClientList searchParams={params} />
        </RequirePermission>
      }
    />
  );
}
