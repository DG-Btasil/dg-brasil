import { Suspense } from "react";
import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { SkeletonRows } from "@/components/feedback/states";
import { ClientDetail } from "@/features/clients/components/detail/client-detail";

export default async function ClientPage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  return (
    <PageContainer>
      <RequirePermission permission="clients.view">
        <Suspense fallback={<SkeletonRows rows={6} />}>
          <ClientDetail id={id} />
        </Suspense>
      </RequirePermission>
    </PageContainer>
  );
}
