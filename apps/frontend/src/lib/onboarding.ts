/**
 * Introdução do PRODUTO (tour) — não confundir com o onboarding de SEGURANÇA
 * (convite → senha → termos → MFA), que é obrigatório e fica em lib/auth.
 *
 * O tour aparece uma vez por USUÁRIO: o estado canônico é
 * `user_preferences.tour_completed_at` no banco, lido pelo servidor. Vale em
 * qualquer navegador ou computador; nada disso fica no localStorage.
 */

/** Mostra o convite para a introdução? Só se nunca concluiu/pulou, na Home. */
export function shouldOfferProductTour(state: {
  completedAt: string | null;
  pathname: string;
  promptDismissed: boolean;
  active: boolean;
}): boolean {
  return state.completedAt === null && !state.promptDismissed && !state.active && state.pathname === "/home";
}

/** Concluir de novo (ex.: rever a introdução) não muda a data da primeira vez. */
export function firstCompletion(existing: string | null | undefined, now: Date): string {
  return existing ?? now.toISOString();
}
