"use client";

import { useState } from "react";
import { CornerDownLeft, Lightbulb, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CANNED_FREE_TEXT_REPLY } from "../agent-scripts";
import type { AgentScript } from "../types";

interface Message {
  id: number;
  from: "user" | "assistant";
  text: string;
  canned?: boolean;
}

/**
 * Assistente de implantação. Nesta demonstração todas as respostas são
 * pré-definidas: nada é gerado por modelo e não há simulação de "pensando".
 */
export function AgentPanel({
  script,
  stepLabel,
  onApplySuggestion,
}: {
  script: AgentScript;
  stepLabel: string;
  onApplySuggestion?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [applied, setApplied] = useState(false);

  const push = (...items: Omit<Message, "id">[]) =>
    setMessages((prev) => [...prev, ...items.map((m, i) => ({ ...m, id: prev.length + i }))]);

  const asked = new Set(messages.filter((m) => m.from === "user").map((m) => m.text));

  return (
    <aside aria-label="Assistente de implantação" className="flex flex-col rounded-lg border border-line bg-surface shadow-hairline">
      <header className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-navy-600" aria-hidden />
          <h2 className="text-[13.5px] font-semibold text-foreground">Assistente de implantação</h2>
        </div>
        <p className="mt-0.5 text-[11.5px] text-muted">Respostas pré-definidas nesta demonstração</p>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div>
          <p className="eyebrow mb-1">{stepLabel}</p>
          <p className="text-[12.5px] leading-relaxed text-foreground/85">{script.intro}</p>
        </div>

        {script.suggestion && onApplySuggestion && (
          <div className="rounded-md border border-gold/50 bg-gold-50 px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-gold-600">
              <Lightbulb className="size-3.5" aria-hidden /> Sugestão
            </p>
            <p className="mt-1 text-[12.5px] font-medium text-foreground">{script.suggestion.title}</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{script.suggestion.description}</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2.5"
              onClick={() => {
                onApplySuggestion();
                setApplied(true);
              }}
            >
              {applied ? "Aplicar novamente" : "Aplicar ao formulário"}
            </Button>
            {applied && (
              <p role="status" className="mt-1.5 text-[11.5px] text-muted">
                Campos preenchidos. Revise antes de salvar.
              </p>
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-[11.5px] font-medium text-muted">Perguntas frequentes</p>
          <ul className="space-y-1.5">
            {script.questions.map((q) => (
              <li key={q.question}>
                <button
                  type="button"
                  disabled={asked.has(q.question)}
                  onClick={() => push({ from: "user", text: q.question }, { from: "assistant", text: q.answer })}
                  className="w-full rounded-md border border-line px-3 py-2 text-left text-[12.5px] text-navy-700 transition-colors hover:border-navy-600/40 hover:bg-surface-muted disabled:cursor-default disabled:text-muted disabled:hover:bg-transparent"
                >
                  {q.question}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <ol aria-live="polite" aria-label="Conversa com o assistente" className={cn("space-y-2.5", messages.length === 0 && "hidden")}>
          {messages.map((m) => (
            <li key={m.id} className={cn("flex", m.from === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[92%] rounded-lg px-3 py-2 text-[12.5px] leading-relaxed",
                  m.from === "user" ? "bg-navy text-white" : "border border-line bg-surface-muted text-foreground",
                )}
              >
                <span className="sr-only">{m.from === "user" ? "Você: " : "Assistente: "}</span>
                {m.canned && <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Resposta pré-definida</span>}
                {m.text}
              </div>
            </li>
          ))}
        </ol>
      </div>

      <form
        className="mt-auto border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          push({ from: "user", text: t }, { from: "assistant", text: CANNED_FREE_TEXT_REPLY, canned: true });
          setDraft("");
        }}
      >
        <label htmlFor="onboarding-agent-input" className="sr-only">
          Pergunte ao assistente
        </label>
        <div className="flex items-center gap-2">
          <input
            id="onboarding-agent-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Pergunte sobre esta etapa"
            className="h-8 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] placeholder:text-subtle focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-gold/25"
          />
          <Button type="submit" size="sm" variant="secondary" aria-label="Enviar pergunta" icon={<CornerDownLeft className="size-3.5" aria-hidden />} />
        </div>
        <p className="mt-1.5 text-[11px] text-subtle">O assistente responde com orientações pré-definidas nesta demonstração.</p>
      </form>
    </aside>
  );
}
