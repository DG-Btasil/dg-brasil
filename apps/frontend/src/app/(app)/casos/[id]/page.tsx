import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { CaseDetail } from "@/features/cases/components/case-detail";
import { PortalCaseDetail } from "@/features/partner-portal/components/portal-cases";

export default async function CasePage({ params }: PageProps<"/casos/[id]">) {
  const { id } = await params;
  // Parceiro: caso de outro escritório não existe no estado recortado e aparece como "não encontrado".
  return (
    <AudienceSwitch
      owner={
        <PageContainer>
          <RequirePermission permission="cases.view">
            <Suspense fallback={<SkeletonRows rows={6} />}>
              <CaseDetail id={id} />
            </Suspense>
          </RequirePermission>
        </PageContainer>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <Suspense fallback={<SkeletonRows rows={6} />}>
            <PortalCaseDetail id={id} />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
