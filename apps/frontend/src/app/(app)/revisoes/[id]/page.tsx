import type { Metadata } from "next";
import { FileSearch } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { RequirePermission } from "@/components/layout/server-guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { ReviewDetail } from "@/features/reviews/components/review-detail";
import { getOfficeStatusAction } from "@/server/domain/dg/actions";
import { getReviewAction } from "@/server/domain/reviews/actions";

export const metadata: Metadata = { title: "Revisão" };

function ReviewNotFound() {
  return (
    <PageContainer>
      <Panel className="mt-6">
        <EmptyState
          icon={FileSearch}
          title="Revisão não encontrada."
          description="O item pode ter sido removido ou o endereço está incorreto."
          action={
            <ButtonLink href="/revisoes" variant="secondary">
              Voltar para Revisões
            </ButtonLink>
          }
        />
      </Panel>
    </PageContainer>
  );
}

/**
 * Revisão com o conteúdo do alvo, lido no servidor a cada acesso. A situação
 * do computador do escritório vem junto, só para o aviso do "Pedir para o
 * agente refazer" (o pedido entra na fila mesmo com ele desligado).
 */
async function Review({ id }: { id: string }) {
  const [result, office] = await Promise.all([getReviewAction({ id }), getOfficeStatusAction()]);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND" || result.error.code === "VALIDATION") return <ReviewNotFound />;
    return (
      <PageContainer>
        <ActionErrorState error={result} title="Não foi possível abrir a revisão." />
      </PageContainer>
    );
  }
  return <ReviewDetail review={result.data} office={office.ok ? { executionEnabled: office.data.executionEnabled, online: office.data.online } : undefined} />;
}

export default async function ReviewDetailPage({ params }: PageProps<"/revisoes/[id]">) {
  const { id } = await params;
  return (
    <RequirePermission permission="reviews.view">
      <Review id={id} />
    </RequirePermission>
  );
}
