"use client";

import { useCallback, useMemo } from "react";
import { REVIEW_DECISION_LABEL, type ReviewDecisionKind } from "@/lib/constants/status";
import { repositories } from "@/repositories";
import { useAppStore } from "@/store/app-store";
import { useToast } from "@/store/ui-store";
import type { Agent, ClientDocument, ID, LegalThesis, Process, Review, ReviewDecision, Skill } from "@/types";
import { APPROVAL_OUTCOME, compareReviewQueue, isOpenReview } from "./utils";

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export function useReviews(): Review[] {
  return useAppStore((s) => s.reviews);
}

export function useReview(id: ID): Review | undefined {
  const reviews = useReviews();
  return useMemo(() => reviews.find((r) => r.id === id), [reviews, id]);
}

export function useReviewDecisions(reviewId: ID): ReviewDecision[] {
  const decisions = useAppStore((s) => s.reviewDecisions);
  return useMemo(() => decisions.filter((d) => d.reviewId === reviewId).sort((a, b) => b.at.localeCompare(a.at)), [decisions, reviewId]);
}

function useMapOf<T extends { id: ID }>(list: T[]): Map<ID, T> {
  return useMemo(() => new Map(list.map((item) => [item.id, item])), [list]);
}

export function useAgentMap(): Map<ID, Agent> {
  return useMapOf(useAppStore((s) => s.agents));
}

export function useSkillMap(): Map<ID, Skill> {
  return useMapOf(useAppStore((s) => s.skills));
}

export function useThesisMap(): Map<ID, LegalThesis> {
  return useMapOf(useAppStore((s) => s.theses));
}

export function useDocumentMap(): Map<ID, ClientDocument> {
  return useMapOf(useAppStore((s) => s.documents));
}

export function useProcessMap(): Map<ID, Process> {
  return useMapOf(useAppStore((s) => s.processes));
}

export function useClientList() {
  return useAppStore((s) => s.clients);
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
  return { decide };
}
