import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { ProcessList } from "@/features/processes/components/process-list";
import { processQueryFromSearchParams, processQueryToInput } from "@/features/processes/list-query";
import { PortalProcessList } from "@/features/partner-portal/components/portal-processes";
import { portalProcessInput, portalQueryFromSearchParams } from "@/features/partner-portal/list-query";
import { getProcessSummaryAction, listProcessesAction } from "@/server/domain/processes/actions";

/** Primeira página carregada no servidor, já com os filtros da URL. */
async function InternalProcessList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = processQueryFromSearchParams(searchParams);
  const [result, summary] = await Promise.all([listProcessesAction(processQueryToInput(query)), getProcessSummaryAction()]);
  const clientLabel = query.clientId && result.ok ? result.data.items[0]?.clientName : undefined;
  return <ProcessList initialQuery={query} initialResult={result} initialClientLabel={clientLabel || undefined} summary={summary} />;
}

/** Portal: primeira página dos processos dos casos do próprio escritório (RLS). */
async function PartnerProcessList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = portalQueryFromSearchParams(searchParams);
  return <PortalProcessList initialQuery={query} initialResult={await listProcessesAction(portalProcessInput(query))} />;
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
          <PartnerProcessList searchParams={params} />
        </RequirePermission>
      }
    />
  );
}
