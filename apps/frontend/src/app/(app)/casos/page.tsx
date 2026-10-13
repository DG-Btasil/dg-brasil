import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { CaseList } from "@/features/cases/components/case-list";
import { caseQueryFromSearchParams, caseQueryToInput } from "@/features/cases/list-query";
import { PortalCaseList } from "@/features/partner-portal/components/portal-cases";
import { portalCaseInput, portalQueryFromSearchParams } from "@/features/partner-portal/list-query";
import { listCasesAction } from "@/server/domain/cases/actions";

/** Primeira página carregada no servidor, já com os filtros da URL. */
async function InternalCaseList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = caseQueryFromSearchParams(searchParams);
  const result = await listCasesAction(caseQueryToInput(query));
  // Nome do cliente do filtro (vindo da URL): o da primeira linha, sem nova leitura da ficha.
  const clientLabel = query.clientId && result.ok ? result.data.items[0]?.clientName : undefined;
  return <CaseList initialQuery={query} initialResult={result} initialClientLabel={clientLabel || undefined} />;
}

/** Portal: primeira página dos casos do próprio escritório (RLS). */
async function PartnerCaseList({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = portalQueryFromSearchParams(searchParams, true);
  return <PortalCaseList initialQuery={query} initialResult={await listCasesAction(portalCaseInput(query))} />;
}

export default async function CasesPage({ searchParams }: PageProps<"/casos">) {
  const params = await searchParams;
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="cases.view">
          <InternalCaseList searchParams={params} />
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <PartnerCaseList searchParams={params} />
        </RequirePermission>
      }
    />
  );
}
