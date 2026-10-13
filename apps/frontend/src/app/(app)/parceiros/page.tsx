import { RequirePermission } from "@/components/layout/server-guards";
import { PartnerList } from "@/features/partners/components/partner-list";
import { partnerQueryFromSearchParams, partnerQueryToInput } from "@/features/partners/list-query";
import { listPartnersAction } from "@/server/domain/organizations/actions";

async function Partners({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = partnerQueryFromSearchParams(searchParams);
  return <PartnerList initialQuery={query} initialResult={await listPartnersAction(partnerQueryToInput(query))} />;
}

export default async function PartnersPage({ searchParams }: PageProps<"/parceiros">) {
  const params = await searchParams;
  return (
    <RequirePermission permission="partners.view">
      <Partners searchParams={params} />
    </RequirePermission>
  );
}
