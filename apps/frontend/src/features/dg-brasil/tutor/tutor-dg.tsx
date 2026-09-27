"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MessagesSquare, RotateCcw, SendHorizontal, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { TUTOR_SCENARIOS } from "./scenarios";
import { SuggestionChips, TutorMessage } from "./tutor-message";
import { useTutorContext, useTutorMessages, useTutorOpen } from "./tutor-store";
import { useTutor } from "./use-tutor";

/**
 * Tutor DG: botão flutuante + painel lateral não bloqueante.
 * Renderizado apenas no layout da área DG Brasil.
 */
export function TutorDg() {
  const open = useTutorOpen();
  const { open: openTutor, close } = useTutor();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  // Devolve o foco ao botão quando o painel fecha.
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Fecha o painel ao sair da área DG Brasil (o layout desmonta).
  useEffect(() => () => close(), [close]);

  return (
    <>
      {!open && (
        <button
          ref={launcherRef}
          type="button"
          onClick={() => openTutor()}
          aria-haspopup="true"
          className="fixed bottom-6 right-6 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-navy-800 bg-navy px-4 text-[13px] font-medium text-white shadow-overlay transition-colors hover:bg-navy-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2"
        >
          <MessagesSquare className="size-4" aria-hidden />
          Tutor DG
        </button>
      )}
      {open && <TutorPanel onClose={close} />}
    </>
  );
}

function TutorPanel({ onClose }: { onClose: () => void }) {
  const messages = useTutorMessages();
  const context = useTutorContext();
  const { send, reset } = useTutor();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit(text: string) {
    if (!text.trim()) return;
    send(text);
    setDraft("");
    inputRef.current?.focus();
  }

  function onPanelKeyDown(e: KeyboardEvent<HTMLElement>) {
    // ESC fecha o painel, exceto quando um diálogo interno está aberto (ele trata o próprio ESC).
    if (e.key !== "Escape") return;
    if ((e.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    onClose();
  }

  function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  }

  return (
    <aside
      aria-labelledby="tutor-dg-title"
      onKeyDown={onPanelKeyDown}
      className="fixed bottom-0 right-0 top-[var(--header-height)] z-40 flex w-[420px] max-w-[calc(100vw-32px)] flex-col border-l border-line bg-surface shadow-overlay animate-slide-in-right"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 id="tutor-dg-title" className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
            <MessagesSquare className="size-4 text-navy-700" aria-hidden />
            Tutor DG
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted">Ajuda a configurar agentes, ajustar Skills e corrigir comportamentos.</p>
          <p className="mt-1.5 text-[11.5px] text-subtle">Nesta demonstração, o Tutor usa cenários pré-definidos.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messages.length > 0 && (
            <IconButton size="sm" label="Nova conversa" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden />
            </IconButton>
          )}
          <IconButton size="sm" label="Fechar Tutor DG" onClick={onClose}>
            <X className="size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      {context && (
        <div className="border-b border-line bg-surface-muted px-5 py-2 text-[12px] text-muted">
          Contexto: <span className="font-medium text-foreground">Skill {context.skillName}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 && (
          <div className="mb-4">
            <p className="text-[13px] leading-relaxed text-foreground">
              Descreva o que você gostaria de mudar no comportamento de um agente. Eu identifico a Skill ou regra responsável, explico o impacto e proponho
              a alteração — que só é aplicada depois da sua confirmação.
            </p>
            <p className="mb-2 mt-4 text-[11.5px] font-medium uppercase tracking-[0.05em] text-subtle">Pedidos sugeridos</p>
            <SuggestionChips items={TUTOR_SCENARIOS.map((s) => s.prompt)} onPick={submit} />
          </div>
        )}
        <ol role="log" aria-live="polite" aria-label="Conversa com o Tutor DG" className="space-y-4">
          {messages.map((m) => (
            <TutorMessage key={m.id} message={m} onSuggestion={submit} />
          ))}
        </ol>
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <label htmlFor="tutor-dg-input" className="sr-only">
          Mensagem para o Tutor DG
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id="tutor-dg-input"
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ex.: Meu agente de petições está fazendo introduções muito longas."
            className={cn(
              "min-h-[44px] flex-1 resize-none rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-foreground placeholder:text-subtle",
              "focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25",
            )}
          />
          <Button type="submit" disabled={!draft.trim()} icon={<SendHorizontal className="size-4" aria-hidden />}>
            Enviar
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">Enter envia · Shift+Enter quebra linha · Esc fecha</p>
      </form>
    </aside>
  );
}
