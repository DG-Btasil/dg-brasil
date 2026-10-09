import { Suspense } from "react";
import { PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { NewProcessPage } from "@/features/processes/components/new-process-page";
import { PortalProcessForm } from "@/features/partner-portal/components/portal-processes";

const fallback = (
  <PageContainer>
    <SkeletonRows rows={8} />
  </PageContainer>
);

export default function NewProcessRoute() {
  return (
    <AudienceSwitch
      owner={
        <RequirePermission permission="processes.edit">
          <Suspense fallback={fallback}>
            <NewProcessPage />
          </Suspense>
        </RequirePermission>
      }
      partner={
        <RequirePermission permission="partnerPortal.processes.create">
          <Suspense fallback={fallback}>
            <PortalProcessForm />
          </Suspense>
        </RequirePermission>
      }
    />
  );
}
