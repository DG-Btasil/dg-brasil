"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Identificador mascarado por padrão (minimização — LGPD), com revelação
 * explícita e reversível pelo usuário.
 */
export function MaskedIdentifier({ label, masked, full, className }: { label: string; masked: string; full: string; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-subtle">{label}</span>
      <span className="tabular text-foreground" aria-live="polite">
        {revealed ? full : masked}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        aria-pressed={revealed}
        aria-label={revealed ? `Ocultar ${label}` : `Mostrar ${label} completo`}
        className="inline-flex items-center gap-1 rounded-xs px-1 text-[11.5px] font-medium text-navy-700 hover:bg-surface-sunken hover:underline underline-offset-2"
      >
        {revealed ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
        {revealed ? "ocultar" : "mostrar"}
      </button>
    </span>
  );
}
