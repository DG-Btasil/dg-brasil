import { Suspense } from "react";
import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { SkeletonRows } from "@/components/feedback/states";
import { NewProcessPage } from "@/features/processes/components/new-process-page";

export default function NewProcessRoute() {
  return (
    <RequirePermission permission="processes.edit">
      <Suspense
        fallback={
          <PageContainer>
            <SkeletonRows rows={8} />
          </PageContainer>
        }
      >
        <NewProcessPage />
      </Suspense>
    </RequirePermission>
  );
}
