import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { PartnerDetail } from "@/features/partners/components/partner-detail";

export default async function PartnerDetailPage({ params }: PageProps<"/parceiros/[id]">) {
  const { id } = await params;
  // Parceiros não têm "partners.view": /parceiros/<qualquer-id> é bloqueado para eles.
  return (
    <RequirePermission permission="partners.view">
      <Suspense
        fallback={
          <PageContainer>
            <SkeletonRows rows={8} />
          </PageContainer>
        }
      >
        <PartnerDetail id={id} />
      </Suspense>
    </RequirePermission>
  );
}
