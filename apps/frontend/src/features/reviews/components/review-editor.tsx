"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoContentNotice } from "@/components/ui/display";
import type { Review, ReviewContent } from "@/types";
import { useReviewActions } from "../hooks";
import { contentVersionOf } from "../utils";

/**
 * Edição manual do documento, em editor amplo (ocupa a área central).
 * Salvar cria uma NOVA versão (origem MANUAL_EDIT); a anterior fica
 * preservada e a nova volta a aguardar decisão.
 */
export function ReviewEditor({ review, onDone }: { review: Review; onDone: () => void }) {
  const { editContent } = useReviewActions();
  const [draft, setDraft] = useState<ReviewContent>(review.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const current = contentVersionOf(review);

  const dirty =
    draft.title !== review.content.title || draft.sections.some((s, i) => s.body !== review.content.sections[i]?.body || s.heading !== review.content.sections[i]?.heading);

  function setSection(index: number, body: string) {
    setDraft((d) => ({ ...d, sections: d.sections.map((s, i) => (i === index ? { ...s, body } : s)) }));
    setError(undefined);
  }

  async function save() {
    if (!draft.title.trim()) return setError("O título não pode ficar em branco.");
    if (draft.sections.some((s) => !s.body.trim())) return setError("Nenhuma seção pode ficar em branco.");
    setSaving(true);
    const ok = await editContent(review, { ...draft, title: draft.title.trim() });
    setSaving(false);
    if (ok) onDone();
  }

  return (
    <article aria-label="Edição manual do documento" className="overflow-hidden rounded-lg border border-gold/40 bg-surface-muted">
      <div className="sticky top-[var(--header-height)] z-10 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <p className="text-[13px] text-muted">
          <span className="font-semibold text-foreground">Editando manualmente</span> · Versão {current} → Versão {current + 1}. A versão {current} continua no histórico.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" icon={<X className="size-4" aria-hidden />} onClick={onDone} disabled={saving}>
            Cancelar
          </Button>
          <Button icon={<Save className="size-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty}>
            Salvar nova versão
          </Button>
        </div>
      </div>
      <div className="px-6 py-6">
        <div className="mx-auto max-w-[900px] rounded-sm border border-line bg-white px-14 py-12 shadow-soft">
          <DemoContentNotice className="mb-6">{review.content.disclaimer}</DemoContentNotice>
          {error && (
            <p role="alert" className="mb-4 text-[12.5px] font-medium text-danger">
              {error}
            </p>
          )}
          <label className="block">
            <span className="sr-only">Título do documento</span>
            <input
              value={draft.title}
              onChange={(e) => {
                setDraft((d) => ({ ...d, title: e.target.value }));
                setError(undefined);
              }}
              className="w-full rounded-sm border border-transparent bg-transparent px-1 font-serif text-[24px] font-medium leading-snug text-navy hover:border-line focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25"
            />
          </label>
          <div className="mt-8 space-y-7">
            {draft.sections.map((section, i) => (
              <label key={`${section.heading}-${i}`} className="block">
                <span className="block text-[12px] font-semibold uppercase tracking-[0.08em] text-navy-700">{section.heading}</span>
                <textarea
                  value={section.body}
                  onChange={(e) => setSection(i, e.target.value)}
                  rows={Math.max(8, section.body.split("\n").length + Math.ceil(section.body.length / 95) + 2)}
                  className="mt-2 w-full resize-y rounded-sm border border-line bg-white px-3 py-2.5 text-[14px] leading-[1.75] text-foreground hover:border-navy-600/40 focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
