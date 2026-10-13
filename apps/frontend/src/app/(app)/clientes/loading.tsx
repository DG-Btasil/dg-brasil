import { PageContainer } from "@/components/layout/guards";
import { SkeletonRows } from "@/components/feedback/states";
import { Panel } from "@/components/ui/panel";

/** Enquanto o servidor carrega clientes: esqueleto, nunca dado de demonstração. */
export default function Loading() {
  return (
    <PageContainer>
      <div className="mb-6 h-12" aria-hidden />
      <Panel>
        <SkeletonRows rows={8} />
      </Panel>
    </PageContainer>
  );
}
