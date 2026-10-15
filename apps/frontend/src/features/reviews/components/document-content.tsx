"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, Pencil, Save, Sparkles, X } from "lucide-react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useIdempotencyKey } from "@/lib/hooks/use-idempotency-key";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { Tooltip } from "@/components/ui/tooltip";
import { getReviewContentAction, saveManualRevisionAction } from "@/server/domain/reviews/actions";
import type { ReviewContentDTO } from "@/server/domain/reviews/dto";
import { useToast } from "@/store/ui-store";
import { contentNotEditableMessage, isEditableMime } from "../manual-revision";

/**
 * Conteúdo da minuta em revisão e edição manual (4.3.1, migration 034).
 * Salvar cria a versão N+1 (origem "edição manual") com revisão nova; a
 * versão N e as decisões dela ficam intactas. A tela muda depois da resposta
 * do servidor (sem otimismo) e navega para a revisão da versão nova.
 */
export function DocumentContentPanel({ reviewId, mimeType, canEdit }: { reviewId: string; mimeType?: string; canEdit: boolean }) {
  const textual = isEditableMime(mimeType);
  const [content, setContent] = useState<ActionResult<ReviewContentDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!textual) return;
    let alive = true;
    // Ler é acesso a dado pessoal: o servidor registra (LGPD) como um download.
    callAction(() => getReviewContentAction({ id: reviewId })).then((r) => alive && setContent(r));
    return () => {
      alive = false;
    };
  }, [reviewId, textual, version]);

  if (!textual) {
    return (
      <Callout tone="neutral" title="Conteúdo não editável aqui">
        {contentNotEditableMessage("FORMAT")}
      </Callout>
    );
  }
  if (!content) {
    return (
      <Panel>
        <SkeletonRows rows={6} />
      </Panel>
    );
  }
  if (!content.ok) return <ActionErrorState error={content} onRetry={() => setVersion((v) => v + 1)} title="Não foi possível abrir o conteúdo." />;
  const data = content.data;
  if (data.kind === "UNAVAILABLE") {
    return (
      <Callout tone="neutral" title="Conteúdo não editável aqui">
        {contentNotEditableMessage(data.reason)}
      </Callout>
    );
  }
  const editable = canEdit && data.editable;
  if (editing && editable) return <ManualEditor reviewId={reviewId} content={data} onCancel={() => setEditing(false)} />;

  return (
    <Panel>
      <PanelHeader
        title="Conteúdo"
        description={
          editable
            ? `Versão ${data.versionNumber}. Editar cria a versão ${data.versionNumber + 1}; esta continua no histórico.`
            : `Versão ${data.versionNumber}.${data.readOnlyReason ? ` ${contentNotEditableMessage(data.readOnlyReason)}` : ""}`
        }
        actions={
          editable ? (
            <div className="flex gap-2">
              <Tooltip content="Disponível quando a execução real dos agentes for ativada. Também vai gerar uma versão nova, nunca alterar esta.">
                <span tabIndex={0}>
                  <Button size="sm" variant="ghost" icon={<Sparkles className="size-3.5" aria-hidden />} disabled aria-disabled>
                    Solicitar alteração à IA
                  </Button>
                </span>
              </Tooltip>
              <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" aria-hidden />} onClick={() => setEditing(true)}>
                Editar conteúdo
              </Button>
            </div>
          ) : undefined
        }
      />
      <PanelBody>
        <div className="mx-auto max-w-[900px] rounded-sm border border-line bg-white px-10 py-8 shadow-soft">
          <pre className="whitespace-pre-wrap break-words font-serif text-[14px] leading-[1.75] text-foreground">{data.text}</pre>
        </div>
      </PanelBody>
    </Panel>
  );
}

function ManualEditor({ reviewId, content, onCancel }: { reviewId: string; content: Extract<ReviewContentDTO, { kind: "TEXT" }>; onCancel: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const idempotency = useIdempotencyKey();
  const [draft, setDraft] = useState(content.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const dirty = draft !== content.text;

  async function save() {
    if (saving) return;
    if (!draft.trim()) return setError("O conteúdo não pode ficar em branco.");
    const payload = { reviewId, baseVersionId: content.versionId, content: draft };
    setSaving(true);
    const r = await callAction(() => saveManualRevisionAction({ ...payload, idempotencyKey: idempotency.keyFor(payload) }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível salvar a nova versão.");
      return;
    }
    idempotency.reset();
    toast({ tone: "success", title: `Versão ${r.data.versionNumber} enviada para revisão`, description: `A versão ${content.versionNumber} continua no histórico, com as decisões dela.` });
    router.push(`/revisoes/${r.data.reviewId}`);
  }

  function cancel() {
    if (dirty && !window.confirm("Descartar as alterações não salvas?")) return;
    onCancel();
  }

  return (
    <article aria-label="Edição manual do documento" className="overflow-hidden rounded-lg border border-gold/40 bg-surface-muted">
      <div className="sticky top-[var(--header-height)] z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-foreground">Editando manualmente</span> · Versão {content.versionNumber} → Versão {content.versionNumber + 1}. A versão{" "}
          {content.versionNumber} continua no histórico.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={<X className="size-4" aria-hidden />} onClick={cancel} disabled={saving}>
            Cancelar
          </Button>
          <Button icon={<Save className="size-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty}>
            Salvar nova versão
          </Button>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="mx-auto max-w-[900px] rounded-sm border border-line bg-white px-10 py-8 shadow-soft">
          {error && (
            <p role="alert" className="mb-4 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-navy-700">
              <FileText className="size-3.5" aria-hidden /> Conteúdo da versão {content.versionNumber + 1}
            </span>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setError(undefined);
              }}
              rows={Math.max(16, draft.split("\n").length + Math.ceil(draft.length / 95) + 2)}
              className="w-full resize-y rounded-sm border border-line bg-white px-3 py-2.5 font-serif text-[14px] leading-[1.75] text-foreground hover:border-navy-600/40 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25"
            />
          </label>
        </div>
      </div>
    </article>
  );
}
