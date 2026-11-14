"use client";

import { create } from "zustand";
import { createId } from "@/lib/ids";

/** Estado efêmero de interface (não persistido): toasts e tour guiado. */

export type ToastTone = "success" | "info" | "warning" | "danger";
export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface UiState {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  tourActive: boolean;
  /** O tour pede o menu da casa aberto para mostrar um módulo. */
  tourMenuOpen: boolean;
  setTourMenuOpen: (open: boolean) => void;
  tourStep: number;
  startTour: () => void;
  setTourStep: (step: number) => void;
  endTour: () => void;

  /** Evita reabrir o convite do tour na mesma sessão do navegador. */
  tourPromptDismissed: boolean;
  dismissTourPrompt: () => void;

  /**
   * Recarga dos dados do servidor depois de uma gravação (router.refresh numa
   * transição do RefreshHost, que nunca sai da tela). `refreshing` fica true
   * até a tela nova chegar: as listas e o aviso "Atualizando" usam isso.
   */
  refresher: (() => void) | null;
  setRefresher: (refresher: (() => void) | null) => void;
  refreshing: boolean;
  setRefreshing: (refreshing: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  toasts: [],
  pushToast: (toast) => {
    const id = createId("toast");
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...toast, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  tourActive: false,
  tourMenuOpen: false,
  setTourMenuOpen: (open) => set({ tourMenuOpen: open }),
  tourStep: 0,
  startTour: () => set({ tourActive: true, tourStep: 0, tourPromptDismissed: true }),
  setTourStep: (step) => set({ tourStep: step }),
  endTour: () => set({ tourActive: false, tourStep: 0, tourMenuOpen: false }),

  tourPromptDismissed: false,
  dismissTourPrompt: () => set({ tourPromptDismissed: true }),

  refresher: null,
  setRefresher: (refresher) => set({ refresher }),
  refreshing: false,
  setRefreshing: (refreshing) => set({ refreshing }),
}));

/** Atalho para feedback de sucesso/erro após ações. */
export function useToast() {
  return useUiStore((s) => s.pushToast);
}
