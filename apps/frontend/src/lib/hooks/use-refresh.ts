"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useUiStore } from "@/store/ui-store";

/**
 * Recarrega os dados do servidor depois de uma gravação (no lugar de chamar
 * `router.refresh()` direto). A recarga roda numa transição do RefreshHost
 * (app-shell), que fica na tela o tempo todo: mesmo que o diálogo que gravou
 * feche, o aviso "Atualizando" continua até a tela nova chegar. Fora da área
 * autenticada (sem o host), cai no `router.refresh()` comum.
 */
export function useRefresh(): () => void {
  const router = useRouter();
  const refresher = useUiStore((s) => s.refresher);
  return useCallback(() => (refresher ? refresher() : router.refresh()), [refresher, router]);
}

/** true enquanto uma recarga pedida por `useRefresh` não chegou. */
export function useRefreshing(): boolean {
  return useUiStore((s) => s.refreshing);
}
