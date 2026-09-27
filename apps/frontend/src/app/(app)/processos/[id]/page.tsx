import { Suspense } from "react";
import { PageContainer, RequirePermission } from "@/components/layout/guards";
import { SkeletonRows } from "@/components/feedback/states";
import { ProcessDetail } from "@/features/processes/components/process-detail";

export default async function ProcessDetailPage({ params }: PageProps<"/processos/[id]">) {
  const { id } = await params;
  return (
    <RequirePermission permission="processes.view">
      <Suspense
        fallback={
          <PageContainer>
            <SkeletonRows rows={8} />
          </PageContainer>
        }
      >
        <ProcessDetail id={id} />
      </Suspense>
    </RequirePermission>
  );
}
