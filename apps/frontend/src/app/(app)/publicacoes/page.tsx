import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied, PageContainer } from "@/components/layout/guards";
import { AudienceSwitch, RequirePermission } from "@/components/layout/server-guards";
import { SkeletonRows } from "@/components/feedback/states";
import { PageHeader } from "@/components/ui/display";
import { PublicationsInbox } from "@/features/judicial/components/publications-inbox";

export const metadata: Metadata = { title: "Publicações" };

/** Caixa de publicações do DJEN (043). Só a equipe interna; o parceiro vê as publicações no próprio processo. */
export default function PublicacoesPage() {
  return (
    <AudienceSwitch
      partner={<AccessDenied />}
      owner={
        <RequirePermission permission="processes.view">
          <PageContainer>
            <PageHeader
              title="Publicações"
              description="Intimações e publicações do DJEN nos processos cadastrados no DG Brasil. Abra cada uma para criar o prazo (com a contagem em dias úteis) ou registrar que não há prazo."
            />
            <Suspense fallback={<SkeletonRows rows={6} />}>
              <PublicationsInbox />
            </Suspense>
          </PageContainer>
        </RequirePermission>
      }
    />
  );
}
