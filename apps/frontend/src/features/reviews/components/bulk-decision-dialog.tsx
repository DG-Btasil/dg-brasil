"use client";

import { useId, useState } from "react";
import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import { pluralize } from "@/lib/formatting";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { Callout } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { decideReviewsBulkAction } from "@/server/domain/reviews/actions";
import { bulkBlock, bulkBlockMessage, type BulkDecision } from "@/server/domain/reviews/bulk-rules";
import type { BulkDecisionItemDTO, BulkDecisionResultDTO, ReviewListItem } from "@/server/domain/reviews/dto";
import { rejectSchema } from "../schemas";

const TEXT: Record<BulkDecision, { title: string; included: string; confirm: (n: number) => string; done: string }> = {
  APPROVED: {
    title: "Aprovar os itens marcados",
    included: "Serão aprovados",
    confirm: (n) => `Aprovar ${pluralize(n, "item", "itens")}`,
    done: "aprovado",
  },
  REJECTED: {
    title: "Rejeitar os itens marcados",
    included: "Serão rejeitados",
    confirm: (n) => `Rejeitar ${pluralize(n, "item", "itens")}`,
    done: "rejeitado",
  },
};

/** Um item numa lista do diálogo: o rótulo, o que a proposta pede e, se houver, a observação. */
function ItemLine({ subject, detail, note, icon }: { subject: string; detail?: string; note?: string; icon?: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[13px] font-medium text-foreground">{detail ? `${subject}: ${detail}` : subject}</span>
        {note && <span className="block text-[12px] text-muted">{note}</span>}
      </span>
    </li>
  );
}

const OUTCOME_ICON: Record<BulkDecisionItemDTO["outcome"], React.ReactNode> = {
  DECIDED: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />,
  SKIPPED: <CircleSlash className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden />,
  FAILED: <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />,
};

/**
 * Confirmação da decisão em conjunto. Mostra, ANTES de confirmar, a lista
 * exata do que será decidido e o que fica de fora, com o motivo. Só os itens
 * da primeira lista vão ao servidor, que confere tudo de novo e decide um a
 * um; depois, o resultado aparece item a item.
 */
export function BulkDecisionDialog({
  decision,
  items,
  isAdmin,
  onClose,
  onDone,
}: {
  decision: BulkDecision;
  /** Os itens marcados na tela. */
  items: ReviewListItem[];
  isAdmin: boolean;
  onClose: () => void;
  /** Houve decisão: a fila precisa ser lida de novo. */
  onDone: () => void;
}) {
  const formId = useId();
  const failed = useActionFeedback();
  const text = TEXT[decision];
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BulkDecisionResultDTO>();

  const included = items.filter((i) => bulkBlock(i, decision, isAdmin) === null);
  const excluded = items.flatMap((i) => {
    const reason = bulkBlock(i, decision, isAdmin);
    return reason ? [{ item: i, message: bulkBlockMessage(reason, i) }] : [];
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  async function confirm() {
    if (saving || included.length === 0) return;
    let justification: string | undefined;
    if (decision === "REJECTED") {
      const parsed = rejectSchema.safeParse({ comment: notes });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Informe o motivo da rejeição.");
      justification = parsed.data.comment;
    }
    setSaving(true);
    const r = await callAction(() => decideReviewsBulkAction({ ids: included.map((i) => i.id), decision, notes: justification }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível registrar as decisões.");
      return;
    }
    setResult(r.data);
  }

  function close() {
    if (saving) return;
    // Com resultado na tela, a fila é lida de novo ao fechar (mesmo sem decisão: um item pode ter sido decidido por outra pessoa).
    if (result) onDone();
    onClose();
  }

  if (result) {
    return (
      <Dialog
        open
        onOpenChange={(o) => !o && close()}
        title="Resultado da decisão em conjunto"
        description={`${pluralize(result.decided, `item ${text.done}`, `itens ${text.done}s`)}${
          result.skipped > 0 ? ` · ${pluralize(result.skipped, "ficou de fora", "ficaram de fora")}` : ""
        }${result.failed > 0 ? ` · ${pluralize(result.failed, "não foi decidido", "não foram decididos")}` : ""}`}
        size="lg"
        footer={<Button onClick={close}>Fechar</Button>}
      >
        {result.failed > 0 && (
          <Callout tone="warning" title="Alguns itens não foram decididos" className="mb-3">
            Os demais já estão decididos. Abra cada item que falhou para decidir.
          </Callout>
        )}
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Resultado item a item">
          {result.items.map((r) => (
            <ItemLine
              key={r.id}
              icon={OUTCOME_ICON[r.outcome]}
              subject={r.subject ?? "Revisão"}
              detail={byId.get(r.id)?.detail}
              note={r.outcome === "DECIDED" ? `Decisão registrada: ${text.done}.` : r.message}
            />
          ))}
        </ul>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && close()}
      title={text.title}
      description="Cada item recebe a sua própria decisão, registrada no seu nome. Confira a lista antes de confirmar."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant={decision === "REJECTED" ? "danger" : "primary"} loading={saving} disabled={included.length === 0}>
            {text.confirm(included.length)}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        {decision === "APPROVED" && included.length > 0 && (
          <Callout tone="warning" title="Aprovar aplica cada proposta">
            O que cada proposta pede passa a valer no caso, em até um minuto. A aprovação não se desfaz por aqui.
          </Callout>
        )}
        {included.length === 0 ? (
          <Callout tone="neutral" title="Nenhum dos itens marcados pode ser decidido em conjunto">
            Abra cada item para ler e decidir.
          </Callout>
        ) : (
          <section aria-label={text.included}>
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-foreground">
              {text.included} ({included.length})
            </h3>
            <ul className="divide-y divide-line rounded-md border border-line">
              {included.map((i) => (
                <ItemLine key={i.id} subject={i.subject} detail={i.detail} note={[i.caseTitle, i.clientName].filter(Boolean).join(" · ") || undefined} />
              ))}
            </ul>
          </section>
        )}
        {excluded.length > 0 && (
          <section aria-label="Ficam de fora">
            <h3 className="mb-1.5 text-[12.5px] font-semibold text-foreground">Ficam de fora ({excluded.length})</h3>
            <ul className="divide-y divide-line rounded-md border border-line bg-surface-muted">
              {excluded.map(({ item, message }) => (
                <ItemLine key={item.id} subject={item.subject} detail={item.detail} note={message} />
              ))}
            </ul>
          </section>
        )}
        {decision === "REJECTED" && included.length > 0 && (
          <Field label="Motivo da rejeição" requirement="required" hint="Vale para todos os itens da lista e fica no histórico de cada um." error={error}>
            {(a) => (
              <Textarea
                {...a}
                rows={4}
                maxLength={5000}
                value={notes}
                placeholder="Explique por que o material não deve seguir."
                onChange={(e) => {
                  setNotes(e.target.value);
                  setError(undefined);
                }}
              />
            )}
          </Field>
        )}
      </form>
    </Dialog>
  );
}
