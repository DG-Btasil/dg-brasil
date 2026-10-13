import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ProcessList } from "@/features/processes/components/process-list";
import { processQueryFromSearchParams, processQueryToInput } from "@/features/processes/list-query";
import { PortalProcessList } from "@/features/partner-portal/components/portal-processes";
import { listProcessesAction } from "@/server/domain/processes/actions";

/** Primeira página carregada no servidor, já com os filtros da URL. */
async function InternalProcessList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = processQueryFromSearchParams(searchParams);
  const result = await listProcessesAction(processQueryToInput(query));
  const clientLabel = query.clientId && result.ok ? result.data.items[0]?.clientName : undefined;
  return <ProcessList initialQuery={query} initialResult={result} initialClientLabel={clientLabel || undefined} />;
}

export default async function ProcessesPage({ searchParams }: PageProps<"/processos">) {
  const params = await searchParams;
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.view">
          <InternalProcessList searchParams={params} />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PortalProcessList />
        </RequirePermission>
      }
    />
  );
}
