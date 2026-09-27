"use client";

import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUiStore, type ToastTone } from "@/store/ui-store";

const ICON: Record<ToastTone, typeof Info> = { success: CheckCircle2, info: Info, warning: AlertTriangle, danger: OctagonAlert };
const COLOR: Record<ToastTone, string> = { success: "text-success", info: "text-info", warning: "text-warning", danger: "text-danger" };

/** Feedback de sucesso/erro após ações. Região aria-live. */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[70] flex w-[420px] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.tone];
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 shadow-overlay animate-panel-down">
            <Icon className={cn("mt-0.5 size-4 shrink-0", COLOR[t.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-foreground">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[12.5px] text-muted">{t.description}</p>}
            </div>
            <button type="button" aria-label="Fechar aviso" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-subtle hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
