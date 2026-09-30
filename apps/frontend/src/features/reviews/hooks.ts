"use client";

import { useCallback, useMemo } from "react";
import { REVIEW_DECISION_LABEL, type ReviewDecisionKind } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useScopedStore } from "@/store/scope";
import { useToast } from "@/store/ui-store";
import type { ExportFormat } from "@/lib/constants/status";
import { reviewVersions } from "@/lib/domain/review-versions";
import { saveExportedFile } from "@/lib/export/save";
import type { Agent, ClientDocument, DocumentVersion, ID, LegalThesis, Process, Review, ReviewContent, ReviewDecision, Skill } from "@/types";
import { APPROVAL_OUTCOME, compareReviewQueue, isOpenReview } from "./utils";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useReviews(): Review[] {
  return useScopedStore((s) => s.reviews);
}

export function useReview(id: ID): Review | undefined {
  const reviews = useReviews();
  return useMemo(() => reviews.find((r) => r.id === id), [reviews, id]);
}

export function useReviewDecisions(reviewId: ID): ReviewDecision[] {
  const decisions = useScopedStore((s) => s.reviewDecisions);
  return useMemo(() => decisions.filter((d) => d.reviewId === reviewId).sort((a, b) => b.at.localeCompare(a.at)), [decisions, reviewId]);
}

function useMapOf<T extends { id: ID }>(list: T[]): Map<ID, T> {
  return useMemo(() => new Map(list.map((item) => [item.id, item])), [list]);
}

export function useAgentMap(): Map<ID, Agent> {
  return useMapOf(useScopedStore((s) => s.agents));
}

export function useSkillMap(): Map<ID, Skill> {
  return useMapOf(useScopedStore((s) => s.skills));
}

export function useThesisMap(): Map<ID, LegalThesis> {
  return useMapOf(useScopedStore((s) => s.theses));
}

export function useDocumentMap(): Map<ID, ClientDocument> {
  return useMapOf(useScopedStore((s) => s.documents));
}

export function useProcessMap(): Map<ID, Process> {
  return useMapOf(useScopedStore((s) => s.processes));
}

export function useClientList() {
  return useScopedStore((s) => s.clients);
}

/** Versões do documento (atual primeiro), com a situação de aprovação de cada uma. */
export function useReviewVersions(review: Review | undefined): DocumentVersion[] {
  const decisions = useReviewDecisions(review?.id ?? "");
  return useMemo(() => (review ? reviewVersions(review, decisions) : []), [review, decisions]);
}

/** Revisões pendentes na ordem da fila, para navegar "anterior/próxima". */
export function usePendingNeighbors(currentId: ID): { previous?: Review; next?: Review; position: number; total: number } {
  const reviews = useReviews();
  return useMemo(() => {
    const queue = reviews.filter(isOpenReview).sort(compareReviewQueue);
    const index = queue.findIndex((r) => r.id === currentId);
    if (index === -1) return { next: queue[0], position: 0, total: queue.length };
    return { previous: queue[index - 1], next: queue[index + 1], position: index + 1, total: queue.length };
  }, [reviews, currentId]);
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

export function useReviewActions() {
  const toast = useToast();
  const decide = useCallback(
    async (review: Review, decision: ReviewDecisionKind, comment?: string): Promise<boolean> => {
      try {
        await repositories.reviews.decide(review.id, decision, comment);
        if (decision === "APPROVED") {
          toast({ tone: "success", title: "Revisão aprovada", description: APPROVAL_OUTCOME[review.type] });
        } else if (decision === "CHANGES_REQUESTED") {
          toast({ tone: "info", title: REVIEW_DECISION_LABEL[decision], description: "O agente recebeu suas instruções e está ajustando o material." });
        } else {
          toast({ tone: "warning", title: "Revisão rejeitada", description: "O fluxo foi interrompido e o motivo ficou registrado na auditoria." });
        }
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível registrar a decisão." });
        return false;
      }
    },
    [toast],
  );
  const editContent = useCallback(
    async (review: Review, content: ReviewContent): Promise<boolean> => {
      try {
        await repositories.reviews.editContent(review.id, content);
        toast({ tone: "success", title: "Alterações salvas", description: "A versão anterior foi preservada no histórico. A revisão continua aguardando decisão." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar a edição." });
        return false;
      }
    },
    [toast],
  );

  const reopen = useCallback(
    async (review: Review, reason?: string): Promise<boolean> => {
      try {
        await repositories.reviews.reopen(review.id, reason);
        toast({ tone: "info", title: "Revisão reaberta", description: "A decisão anterior continua no histórico. Uma nova decisão é necessária." });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível reabrir a revisão." });
        return false;
      }
    },
    [toast],
  );

  const requestAgentEdit = useCallback(
    async (review: Review, instruction: string): Promise<boolean> => {
      try {
        await repositories.reviews.requestAgentEdit(review.id, instruction);
        toast({
          tone: "success",
          title: `Nova versão v${(review.contentVersion ?? 1) + 1} criada pelo agente`,
          description: "A versão anterior foi preservada. A nova versão aguarda sua decisão.",
        });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível solicitar a alteração ao agente." });
        return false;
      }
    },
    [toast],
  );

  const download = useCallback(
    async (review: Review, versionNumber: number, format: ExportFormat): Promise<void> => {
      try {
        const file = await repositories.reviews.exportVersion(review.id, versionNumber, format);
        saveExportedFile(file);
        toast({
          tone: file.draft ? "warning" : "success",
          title: file.draft ? `Rascunho v${versionNumber} baixado (${format})` : `Versão aprovada v${versionNumber} baixada (${format})`,
          description: file.draft ? "Arquivo marcado como RASCUNHO — NÃO APROVADO. Não protocolar." : undefined,
        });
      } catch {
        toast({ tone: "danger", title: "Não foi possível gerar o arquivo." });
      }
    },
    [toast],
  );

  return { decide, editContent, reopen, requestAgentEdit, download };
}
