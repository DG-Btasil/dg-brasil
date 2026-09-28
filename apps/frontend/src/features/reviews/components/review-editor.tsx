"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DemoContentNotice } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { Review, ReviewContent } from "@/types";
import { useReviewActions } from "../hooks";
import { contentVersionOf } from "../utils";

/**
 * Edição manual do material, para pequenas correções sem pedir ao agente que
 * regenere tudo. Salvar cria uma nova versão (origem MANUAL_EDIT); a anterior
 * fica preservada no histórico da revisão.
 */
export function ReviewEditor({ review, onDone }: { review: Review; onDone: () => void }) {
  const { editContent } = useReviewActions();
  const [draft, setDraft] = useState<ReviewContent>(review.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

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
    <article aria-label="Edição manual do material" className="rounded-lg border border-gold/40 bg-surface-muted p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          <span className="font-medium text-foreground">Editando manualmente</span> · versão atual v{contentVersionOf(review)}. Ao salvar, a v{contentVersionOf(review) + 1} é criada e
          a anterior continua no histórico.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={<X className="size-4" aria-hidden />} onClick={onDone} disabled={saving}>
            Descartar
          </Button>
          <Button icon={<Save className="size-4" aria-hidden />} onClick={save} loading={saving} disabled={!dirty}>
            Salvar alterações
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-[760px] space-y-5 rounded-sm border border-line bg-white px-10 py-8 shadow-soft">
        <DemoContentNotice>{review.content.disclaimer}</DemoContentNotice>
        {error && (
          <p role="alert" className="text-[12.5px] text-danger">
            {error}
          </p>
        )}
        <Field label="Título" requirement="required">
          {(a) => (
            <Input
              {...a}
              value={draft.title}
              onChange={(e) => {
                setDraft((d) => ({ ...d, title: e.target.value }));
                setError(undefined);
              }}
            />
          )}
        </Field>
        {draft.sections.map((section, i) => (
          <Field key={`${section.heading}-${i}`} label={section.heading} requirement="required">
            {(a) => <Textarea {...a} value={section.body} onChange={(e) => setSection(i, e.target.value)} rows={Math.min(14, Math.max(4, section.body.split("\n").length + 2))} />}
          </Field>
        ))}
      </div>
    </article>
  );
}
