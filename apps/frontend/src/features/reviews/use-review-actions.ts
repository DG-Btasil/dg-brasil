"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import { REVIEW_DECISION_LABEL, type Priority, type ReviewDecisionKind } from "@/lib/constants/status";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { assignReviewAction, decideReviewAction, reopenReviewAction } from "@/server/domain/reviews/actions";
import { useToast } from "@/store/ui-store";

/**
 * Decisões e atribuição de revisão, SEMPRE pelo servidor. Decidir é só pela
 * RPC decide_review (o servidor nunca grava status direto). Sem UI otimista:
 * a tela muda depois da resposta (router.refresh).
 */
export function useReviewActions() {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();

  const run = useCallback(
    async <T>(call: () => Promise<ActionResult<T>>, success: string, failure: string): Promise<boolean> => {
      const result = await callAction(call);
      if (!result.ok) {
        failed(result, failure);
        return false;
      }
      toast({ tone: "success", title: success });
      router.refresh();
      return true;
    },
    [failed, toast, router],
  );

  return useMemo(
    () => ({
      decide: (id: string, decision: ReviewDecisionKind, notes?: string) =>
        run(() => decideReviewAction({ id, decision, notes }), `Revisão: ${REVIEW_DECISION_LABEL[decision].toLowerCase()}`, "Não foi possível registrar a decisão."),
      reopen: (id: string, reason?: string) => run(() => reopenReviewAction({ id, reason }), "Revisão reaberta", "Não foi possível reabrir a revisão."),
      assign: (id: string, patch: { assignedReviewerId?: string | null; priority?: Priority; dueAt?: string | null }) =>
        run(() => assignReviewAction({ id, ...patch }), "Revisão atualizada", "Não foi possível atualizar a revisão."),
    }),
    [run],
  );
}
