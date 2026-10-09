/**
 * Navegação COMPLETA (não client-side) depois de mudar a sessão: login, MFA,
 * termos, senha. Garante que o servidor releia os cookies novos e decida o
 * próximo passo — nunca o navegador.
 */
export function hardNavigate(path: string) {
  window.location.assign(path);
}
