"use client";

import { useState } from "react";
import { Check, CircleSlash, PencilLine, RotateCcw } from "lucide-react";
import { REVIEW_DECISION_LABEL, REVIEW_STATUS_LABEL, type ReviewDecisionKind } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import { useUserMap } from "@/features/offices/hooks";
import type { Review } from "@/types";
import { useReviewActions, useReviewDecisions } from "../hooks";
import { contentVersionOf } from "../utils";
import { DecisionDialog } from "./decision-dialog";
import { ReopenDialog } from "./reopen-dialog";

/**
 * Ações de DECISÃO (somente revisões em aberto e com reviews.decide).
 * Editar e baixar são ações do documento e ficam na barra do visualizador.
 * "Solicitar alterações" é a devolução formal no fluxo; "Editar com agente"
 * é o advogado comandando diretamente uma nova versão.
 */
export function ReviewDecisionBar({ review, editing }: { review: Review; editing: boolean }) {
  const { decide } = useReviewActions();
  const [open, setOpen] = useState<ReviewDecisionKind | null>(null);

  const descriptions: Record<ReviewDecisionKind, string> = {
    APPROVED: `Após esta aprovação, o fluxo seguirá para ${review.nextStepOnApproval}. A aprovação vale para a versão atual (v${contentVersionOf(review)}).`,
    CHANGES_REQUESTED: "O material volta para o agente com as suas instruções e retorna a Revisões depois de ajustado.",
    REJECTED: "O fluxo é interrompido. Nada será executado a partir deste material.",
  };

  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-3.5 shadow-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          {editing ? (
            <>
              <span className="font-medium text-foreground">Edição em andamento.</span> Salve ou descarte para decidir.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">Sua decisão é necessária</span> sobre a versão v{contentVersionOf(review)}. Nada segue sem confirmação humana.
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="danger" icon={<CircleSlash className="size-4" aria-hidden />} onClick={() => setOpen("REJECTED")} disabled={editing}>
            Rejeitar
          </Button>
          <Button variant="secondary" icon={<PencilLine className="size-4" aria-hidden />} onClick={() => setOpen("CHANGES_REQUESTED")} disabled={editing}>
            Solicitar alterações
          </Button>
          <Button icon={<Check className="size-4" aria-hidden />} onClick={() => setOpen("APPROVED")} disabled={editing}>
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

/** Aviso exibido em revisões reabertas: a decisão anterior não vale mais. */
export function ReopenedNotice({ review }: { review: Review }) {
  const decisions = useReviewDecisions(review.id);
  const users = useUserMap();
  const reopened = [...(review.history ?? [])].reverse().find((h) => h.kind === "REOPENED");
  if (review.status !== "REOPENED" || !reopened) return null;
  const previous = decisions.find((d) => d.at <= reopened.at);
  const editedAfter = (review.history ?? []).some((h) => h.kind === "MANUAL_EDIT" && h.at >= reopened.at);
  return (
    <Callout tone="info" title={`Reaberta por ${reopened.actor.name} em ${formatDateTime(reopened.at)}`}>
      <p>
        Decisão anterior: {reopened.previousStatus ? REVIEW_STATUS_LABEL[reopened.previousStatus].toLowerCase() : "—"}
        {previous ? ` por ${users.get(previous.userId)?.name ?? "usuário"} (v${previous.contentVersion ?? 1})` : ""}. Ela continua no histórico, mas não vale para esta
        revisão reaberta{editedAfter ? " nem para a nova versão editada" : ""}: é necessária uma nova decisão.
      </p>
      {reopened.reason && <p className="mt-1 whitespace-pre-line">Motivo: “{reopened.reason}”</p>}
    </Callout>
  );
}

const BANNER_TONE = { APPROVED: "success", CHANGES_REQUESTED: "warning", REJECTED: "neutral" } as const;

/** Faixa somente leitura para revisões já decididas, com a opção de reabrir. */
export function ReviewDecisionBanner({ review }: { review: Review }) {
  const decisions = useReviewDecisions(review.id);
  const users = useUserMap();
  const canReopen = usePermission("reviews.decide");
  const [reopening, setReopening] = useState(false);
  const last = decisions[0];
  if (review.status !== "APPROVED" && review.status !== "CHANGES_REQUESTED" && review.status !== "REJECTED") return null;
  const kind = review.status;
  return (
    <>
      <Callout
        tone={BANNER_TONE[kind]}
        title={`${REVIEW_DECISION_LABEL[kind]}${last ? ` por ${users.get(last.userId)?.name ?? "usuário"} em ${formatDateTime(last.at)}` : ""}${last ? ` · v${last.contentVersion ?? 1}` : ""}`}
        action={
          canReopen ? (
            <Button size="sm" variant="secondary" icon={<RotateCcw className="size-3.5" aria-hidden />} onClick={() => setReopening(true)}>
              Reabrir revisão
            </Button>
          ) : undefined
        }
      >
        {last?.comment ? <p className="whitespace-pre-line">“{last.comment}”</p> : kind === "APPROVED" ? <p>O fluxo seguiu para {review.nextStepOnApproval}.</p> : null}
        {kind === "CHANGES_REQUESTED" && <p className="mt-1">O agente está ajustando o material; a nova versão voltará para Revisões.</p>}
      </Callout>
      {reopening && <ReopenDialog review={review} onClose={() => setReopening(false)} />}
    </>
  );
}
