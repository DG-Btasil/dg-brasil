"use client";

import { useState } from "react";
import { Check, CircleSlash, PencilLine } from "lucide-react";
import { REVIEW_DECISION_LABEL, type ReviewDecisionKind } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/feedback/states";
import { useUserMap } from "@/features/offices/hooks";
import type { Review } from "@/types";
import { useReviewActions, useReviewDecisions } from "../hooks";
import { DecisionDialog } from "./decision-dialog";

/** Barra de decisão (somente revisões em aberto e com reviews.decide). */
export function ReviewDecisionBar({ review }: { review: Review }) {
  const { decide } = useReviewActions();
  const [open, setOpen] = useState<ReviewDecisionKind | null>(null);

  const descriptions: Record<ReviewDecisionKind, string> = {
    APPROVED: `Após esta aprovação, o fluxo seguirá para ${review.nextStepOnApproval}.`,
    CHANGES_REQUESTED: "O material volta para o agente com as suas instruções e retorna a Revisões depois de ajustado.",
    REJECTED: "O fluxo é interrompido. Nada será executado a partir deste material.",
  };

  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-3.5 shadow-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          <span className="font-medium text-foreground">Sua decisão é necessária.</span> Nada segue sem confirmação humana.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="danger" icon={<CircleSlash className="size-4" aria-hidden />} onClick={() => setOpen("REJECTED")}>
            Rejeitar
          </Button>
          <Button variant="secondary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => setOpen("CHANGES_REQUESTED")}>
            Solicitar alterações
          </Button>
          <Button icon={<Check className="size-4" aria-hidden />} onClick={() => setOpen("APPROVED")}>
            Aprovar
          </Button>
        </div>
      </div>
      {open && (
        <DecisionDialog
          key={open}
          decision={open}
          description={descriptions[open]}
          onClose={() => setOpen(null)}
          onConfirm={(comment) => decide(review, open, comment)}
        />
      )}
    </div>
  );
}

const BANNER_TONE = { APPROVED: "success", CHANGES_REQUESTED: "warning", REJECTED: "neutral" } as const;

/** Faixa somente leitura para revisões já decididas. */
export function ReviewDecisionBanner({ review }: { review: Review }) {
  const decisions = useReviewDecisions(review.id);
  const users = useUserMap();
  const last = decisions[0];
  const kind = review.status === "PENDING" || review.status === "URGENT" ? undefined : review.status;
  if (!kind) return null;
  const tone = BANNER_TONE[kind];
  return (
    <Callout tone={tone} title={`${REVIEW_DECISION_LABEL[kind]}${last ? ` por ${users.get(last.userId)?.name ?? "usuário"} em ${formatDateTime(last.at)}` : ""}`}>
      {last?.comment ? <p className="whitespace-pre-line">“{last.comment}”</p> : kind === "APPROVED" ? <p>O fluxo seguiu para {review.nextStepOnApproval}.</p> : null}
      {kind === "CHANGES_REQUESTED" && <p className="mt-1">O agente está ajustando o material; a nova versão voltará para Revisões.</p>}
    </Callout>
  );
}
