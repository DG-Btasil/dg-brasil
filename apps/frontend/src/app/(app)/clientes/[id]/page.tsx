import { Suspense } from "react";
import { AudienceSwitch, PageContainer, RequirePermission } from "@/components/layout/guards";
import { SkeletonRows } from "@/components/feedback/states";
import { ClientDetail } from "@/features/clients/components/detail/client-detail";
import { PortalClientDetail } from "@/features/partner-portal/components/portal-clients";

export default async function ClientPage({ params }: PageProps<"/clientes/[id]">) {
  const { id } = await params;
  // Parceiro: cliente sem vínculo não existe no estado recortado e aparece como "não encontrado".
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="clients.view">
            <Suspense fallback={<SkeletonRows rows={6} />}>
              <ClientDetail id={id} />
            </Suspense>
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
