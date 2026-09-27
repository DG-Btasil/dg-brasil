"use client";

import { Check, CornerDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { StepConfig } from "../types";

export type IndexState = "done" | "current" | "skipped" | "pending";

const STATE_TEXT: Record<IndexState, string> = {
  done: "concluída",
  current: "etapa atual",
  skipped: "pulada",
  pending: "pendente",
};

/** Índice vertical das etapas do wizard (não é navegação da aplicação). */
export function StepIndex({
  steps,
  stateOf,
  canOpen,
  onOpen,
}: {
  steps: StepConfig[];
  stateOf: (index: number) => IndexState;
  canOpen: (index: number) => boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <nav aria-label="Etapas da implantação">
      <ol className="space-y-0.5">
        {steps.map((step, i) => {
          const state = stateOf(i);
          const openable = canOpen(i) && state !== "current";
          const content = (
            <>
              <span
                aria-hidden
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular",
                  state === "done" && "border-navy bg-navy text-white",
                  state === "current" && "border-gold bg-gold-50 text-navy",
                  state === "skipped" && "border-dashed border-line-strong bg-surface text-muted",
                  state === "pending" && "border-line-strong bg-surface text-subtle",
                )}
              >
                {state === "done" ? <Check className="size-3.5" /> : state === "skipped" ? <Minus className="size-3.5" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-[12.5px]",
                    state === "current" ? "font-semibold text-foreground" : state === "pending" ? "text-muted" : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                {state === "skipped" && (
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <CornerDownRight className="size-3" aria-hidden />
                    Pulada
                  </span>
                )}
              </span>
              <span className="sr-only">— {STATE_TEXT[state]}</span>
            </>
          );
          const cls = cn(
            "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left",
            state === "current" && "bg-surface shadow-hairline ring-1 ring-line",
          );
          return (
            <li key={step.key}>
              {openable ? (
                <button type="button" onClick={() => onOpen(i)} className={cn(cls, "transition-colors hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40")}>
                  {content}
                </button>
              ) : (
                <div className={cls} aria-current={state === "current" ? "step" : undefined} aria-disabled={state === "pending" || undefined}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
