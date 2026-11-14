"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { useUiStore } from "@/store/ui-store";

/** Recarga curta não pisca o aviso: ele só aparece se demorar mais que isto. */
const SHOW_AFTER_MS = 250;

/**
 * Dono da recarga pedida por `useRefresh` (lib/hooks/use-refresh). Faz o
 * `router.refresh()` dentro de uma transição: `pending` fica true até o
 * servidor devolver a tela nova, e enquanto isso aparece "Atualizando a
 * tela" no alto (e as listas ficam marcadas como ocupadas). Sem isso, depois
 * de gravar, a lista antiga ficava parada alguns segundos sem nenhum sinal.
 */
export function RefreshHost() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const setRefresher = useUiStore((s) => s.setRefresher);
  const setRefreshing = useUiStore((s) => s.setRefreshing);
  const [delayPassed, setDelayPassed] = useState(false);
  const visible = pending && delayPassed;

  useEffect(() => {
    setRefresher(() => startTransition(() => router.refresh()));
    return () => setRefresher(null);
  }, [router, setRefresher]);

  useEffect(() => {
    setRefreshing(pending);
    if (!pending) return;
    const t = window.setTimeout(() => setDelayPassed(true), SHOW_AFTER_MS);
    return () => {
      window.clearTimeout(t);
      setDelayPassed(false);
    };
  }, [pending, setRefreshing]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(var(--header-height)+8px)] z-[70] flex justify-center">
      {visible && (
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-navy shadow-soft">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Atualizando a tela
        </span>
      )}
    </div>
  );
}
