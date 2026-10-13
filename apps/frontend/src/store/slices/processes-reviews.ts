import {
  viewerOf,
  type GetState,
  type SetState,
} from "../helpers";
import type { AppState, ReviewActions } from "../types";


/** Caixa de notificações do usuário da sessão (interna × parceiro). */
function inboxOf(state: AppState): (n: AppState["notifications"][number]) => boolean {
  const viewer = viewerOf(state);
  if (viewer?.audience === "PARTNER") return (n) => !!viewer.partnerOfficeId && n.partnerOfficeId === viewer.partnerOfficeId;
  return (n) => !n.partnerOfficeId;
}

/** Notificações do mock (Início/Notificações ainda mock até a Fase H). */
export function createReviewSlice(set: SetState, get: GetState): ReviewActions {
  void get;
  return {
    // Leitura de notificação respeita a caixa do usuário: interna ou do próprio parceiro.
    markNotificationRead: (id) =>
      set((s) => {
        const inbox = inboxOf(s);
        return { notifications: s.notifications.map((n) => (n.id === id && inbox(n) ? { ...n, read: true } : n)) };
      }),
    markAllNotificationsRead: () =>
      set((s) => {
        const inbox = inboxOf(s);
        return { notifications: s.notifications.map((n) => (inbox(n) ? { ...n, read: true } : n)) };
      }),
  };
}
