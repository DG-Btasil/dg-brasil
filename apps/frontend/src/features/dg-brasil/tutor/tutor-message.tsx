"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { ProposalCard } from "./proposal-card";
import type { TutorMessage as Message } from "./tutor-store";

export function TutorMessage({ message, onSuggestion }: { message: Message; onSuggestion: (text: string) => void }) {
  const isUser = message.role === "user";
  return (
    <li className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <span className="mb-1 text-[11px] font-medium text-subtle">{isUser ? "Você" : "Tutor DG"}</span>
      <div
        className={cn(
          "max-w-[92%] rounded-md px-3.5 py-2.5 text-[13px] leading-relaxed",
          isUser ? "bg-navy text-white" : "border border-line bg-surface-muted text-foreground",
        )}
      >
        <p>{message.text}</p>
        {message.proposal && <ProposalCard message={message} />}
        {message.links && message.links.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {message.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-navy-700 hover:underline underline-offset-2">
                  {l.label} <ArrowRight aria-hidden className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {message.suggestions && message.suggestions.length > 0 && <SuggestionChips items={message.suggestions} onPick={onSuggestion} className="mt-2" />}
    </li>
  );
}

export function SuggestionChips({ items, onPick, className }: { items: string[]; onPick: (text: string) => void; className?: string }) {
  return (
    <ul aria-label="Pedidos sugeridos" className={cn("flex flex-col items-start gap-1.5", className)}>
      {items.map((s) => (
        <li key={s}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:border-navy-600/50 hover:bg-navy-50/60"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
}
