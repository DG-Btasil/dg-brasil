import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { ProcessDetail } from "@/features/processes/components/process-detail";
import { PortalProcessDetail } from "@/features/partner-portal/components/portal-processes";

const fallback = (
  <PageContainer>
    <SkeletonRows rows={8} />
  </PageContainer>
);

export default async function ProcessDetailPage({ params }: PageProps<"/processos/[id]">) {
  const { id } = await params;
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.view">
          <Suspense fallback={fallback}>
            <ProcessDetail id={id} />
          </Suspense>
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.view">
          <Suspense fallback={fallback}>
            <PortalProcessDetail id={id} />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
