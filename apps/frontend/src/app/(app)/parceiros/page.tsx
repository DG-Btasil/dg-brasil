import { MetricsBoard } from "@/features/metrics/components/metrics-board";
import { getDashboardMetricsAction } from "@/server/domain/metrics/actions";
import { RequirePermission } from "@/components/layout/server-guards";
import { PartnerList } from "@/features/partners/components/partner-list";
import { partnerQueryFromSearchParams, partnerQueryToInput } from "@/features/partners/list-query";
import { listPartnersAction } from "@/server/domain/organizations/actions";

async function Partners({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = partnerQueryFromSearchParams(searchParams);
  const [result, metrics] = await Promise.all([listPartnersAction(partnerQueryToInput(query)), getDashboardMetricsAction({ period: "90" })]);
  return <PartnerList initialQuery={query} initialResult={result} insights={<MetricsBoard variant="partners" initial={metrics} initialPeriod="90" title="Parceiros em números" />} />;
}

export default async function PartnersPage({ searchParams }: PageProps<"/parceiros">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="partners.view">
      <Partners searchParams={params} />
    </RequirePermission>
  );
}
