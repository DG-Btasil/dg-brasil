"use client";

import { useState } from "react";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/features/auth/hooks";
import { ChevronLeft, ChevronRight, FilePen, FileSearch } from "lucide-react";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, REVIEW_TYPE_LABEL } from "@/lib/constants/status";
import { Can, PageContainer } from "@/components/layout/guards";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import { useAgentMap, usePendingNeighbors, useReview, useReviewVersions } from "../hooks";
import { contentVersionOf, isOpenReview, wasManuallyEdited } from "../utils";
import { PriorityBadge } from "./priority-badge";
import { ReviewContext } from "./review-context";
import { ReopenedNotice, ReviewDecisionBanner, ReviewDecisionBar } from "./review-decision-bar";
import { ReviewDocument } from "./review-document";
import { ReviewDocumentToolbar } from "./review-document-toolbar";
import { ReviewEditor } from "./review-editor";

function PendingNavigation({ id }: { id: string }) {
  const { previous, next, position, total } = usePendingNeighbors(id);
  if (total === 0) return null;
  return (
    <nav aria-label="Navegação entre revisões pendentes" className="flex items-center gap-2">
      {position > 0 && <span className="mr-1 text-[12px] text-muted tabular">{position} de {total} pendentes</span>}
      {previous && (
        <ButtonLink href={`/revisoes/${previous.id}`} variant="ghost" size="sm" icon={<ChevronLeft className="size-4" aria-hidden />}>
          Anterior
        </ButtonLink>
      )}
      {next && (
        <ButtonLink href={`/revisoes/${next.id}`} variant="secondary" size="sm">
          Próxima revisão pendente
          <ChevronRight className="size-4" aria-hidden />
        </ButtonLink>
      )}
    </nav>
  );
}

export function ReviewDetail({ id }: { id: string }) {
  const review = useReview(id);
  const agents = useAgentMap();
  const versions = useReviewVersions(review);
  const canDecide = usePermission("reviews.decide");
  const [editing, setEditing] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  if (!review) {
    return (
      <PageContainer>
        <Panel className="mt-6">
          <EmptyState
            icon={FileSearch}
            title="Revisão não encontrada."
            description="O item pode ter sido removido ou o endereço está incorreto."
            action={<ButtonLink href="/revisoes" variant="secondary">Voltar para Revisões</ButtonLink>}
          />
        </Panel>
      </PageContainer>
    );
  }

  const open = isOpenReview(review);
  // Edição só existe enquanto a revisão aguarda decisão.
  const isEditing = editing && open;
  const current = versions[0];
  // Versão exibida: a atual, salvo escolha no seletor (versões antigas são somente leitura).
  const viewed = versions.find((v) => v.versionNumber === viewingVersion) ?? current;
  const viewingOld = !!viewed && !viewed.current;

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Revisões", href: "/revisoes" }, { label: review.title }]}
        eyebrow={REVIEW_TYPE_LABEL[review.type]}
        title={review.title}
        meta={
          <>
            <StatusBadge status={review.status} labels={REVIEW_STATUS_LABEL} tones={REVIEW_STATUS_TONE} />
            {review.status !== "URGENT" && <PriorityBadge priority={review.priority} />}
            {wasManuallyEdited(review) && (
              <Badge tone="neutral" icon={<FilePen className="size-3" aria-hidden />} title={`Conteúdo na versão v${contentVersionOf(review)}`}>
                Editado manualmente · v{contentVersionOf(review)}
              </Badge>
            )}
            <span>Gerado por {agents.get(review.agentId)?.name ?? "agente do DG Brasil"}</span>
          </>
        }
        actions={<PendingNavigation id={review.id} />}
      />

      <div className="mb-5 space-y-3">
        <ReopenedNotice review={review} />
        {open ? (
          <Can permission="reviews.decide">
            <ReviewDecisionBar review={review} editing={isEditing} />
          </Can>
        ) : (
          <ReviewDecisionBanner review={review} />
        )}
      </div>

      {isEditing ? (
        // Edição manual ocupa a área central inteira.
        <ReviewEditor review={review} onDone={() => setEditing(false)} />
      ) : (
        <div className="grid grid-cols-[minmax(0,62fr)_minmax(340px,38fr)] items-start gap-6">
          {viewed && (
            <ReviewDocument
              content={viewed.content}
              toolbar={
                <ReviewDocumentToolbar
                  review={review}
                  versions={versions}
                  viewed={viewed}
                  onSelectVersion={(v) => setViewingVersion(v === current?.versionNumber ? null : v)}
                  canEdit={open && canDecide && !viewingOld}
                  onEditManually={() => setEditing(true)}
                />
              }
              notice={
                viewingOld ? (
                  <Callout
                    tone="neutral"
                    className="mx-auto mb-4 max-w-[760px]"
                    title={`Versão ${viewed.versionNumber} — somente leitura`}
                    action={
                      <Button size="sm" variant="secondary" onClick={() => setViewingVersion(null)}>
                        Ver versão atual
                      </Button>
                    }
                  >
                    Decisões e edições valem apenas para a versão atual (v{current?.versionNumber}).
                  </Callout>
                ) : undefined
              }
            />
          )}
          <aside aria-label="Contexto da revisão" className="sticky top-[calc(var(--header-height)+16px)] max-h-[calc(100vh-var(--header-height)-32px)] overflow-y-auto">
            <ReviewContext review={review} />
          </aside>
        </div>
      )}
    </PageContainer>
  );
}
