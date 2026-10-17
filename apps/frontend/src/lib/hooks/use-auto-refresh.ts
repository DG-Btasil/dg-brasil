"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Atualiza a tela (dados do Server Component) a cada `intervalMs` enquanto
 * `active` — ex.: execução na fila ou rodando. Para sozinho quando a situação
 * deixa de ser ativa ou a aba fica oculta. Sem tempo real (SSE/WebSocket)
 * nesta etapa: consulta periódica curta, só enquanto há o que acompanhar.
 */
export function useAutoRefresh(active: boolean, intervalMs = 8_000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, router]);
}
