import type { AuthOnboardingState, SessionResult } from "./types";

/** Páginas do fluxo de identidade. Uma fonte só para servidor, proxy e telas. */
export const AUTH_ROUTES = {
  login: "/login",
  forgotPassword: "/recuperar-senha",
  newPassword: "/nova-senha",
  firstAccess: "/primeiro-acesso",
  terms: "/termos",
  mfaEnroll: "/seguranca/mfa",
  mfaVerify: "/seguranca/verificar",
  blocked: "/acesso",
  confirm: "/auth/confirm",
  home: "/home",
} as const;

/** Rotas abertas sem sessão. */
export const PUBLIC_PATHS = [AUTH_ROUTES.login, AUTH_ROUTES.forgotPassword, AUTH_ROUTES.blocked, "/auth/"] as const;

/** Rotas do onboarding de segurança: exigem login, não exigem acesso liberado. */
export const ONBOARDING_PATHS = [
  AUTH_ROUTES.newPassword,
  AUTH_ROUTES.firstAccess,
  AUTH_ROUTES.terms,
  AUTH_ROUTES.mfaEnroll,
  AUTH_ROUTES.mfaVerify,
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => (p.endsWith("/") ? pathname.startsWith(p) : pathname === p));
}

export function isOnboardingPath(pathname: string): boolean {
  return (ONBOARDING_PATHS as readonly string[]).includes(pathname);
}

/**
 * Caminho de retorno seguro (anti open-redirect). Aceita só caminho INTERNO
 * da aplicação: começa com "/", não com "//" ou "/\", sem esquema, sem
 * caractere de controle, e nunca uma rota do próprio fluxo de identidade (que
 * criaria laço). Qualquer outra coisa vira o fallback.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = AUTH_ROUTES.home): string {
  if (!raw || typeof raw !== "string") return fallback;
  if (raw.length > 512) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  // O mesmo, depois de decodificar (%0d%0a, %5c, %2f%2f...).
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.startsWith("//")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "http://dg.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://dg.invalid") return fallback;
  const path = url.pathname;
  if (path === "/" || isPublicPath(path) || isOnboardingPath(path)) return fallback;
  return `${path}${url.search}${url.hash}`;
}

const BLOCKED_REASON: Partial<Record<AuthOnboardingState, string>> = {
  PROFILE_MISSING: "conta-inativa",
  PROFILE_INACTIVE: "conta-inativa",
  NO_MEMBERSHIP: "sem-acesso",
  MEMBERSHIP_INACTIVE: "sem-acesso",
  ORGANIZATION_BLOCKED: "escritorio-suspenso",
  ORGANIZATION_PENDING: "escritorio-pendente",
};

/** Para onde a pessoa vai, dado o estado da sessão. `next` só vale se seguro. */
export function destinationFor(result: SessionResult, next?: string | null): string {
  const keep = (path: string) => {
    const safe = safeNextPath(next, "");
    return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
  };
  switch (result.state) {
    case "ANONYMOUS":
      return keep(AUTH_ROUTES.login);
    case "MFA_VERIFY":
      return keep(AUTH_ROUTES.mfaVerify);
    case "LEGAL_PENDING":
      return keep(AUTH_ROUTES.terms);
    case "MFA_ENROLL":
      return keep(AUTH_ROUTES.mfaEnroll);
    case "READY":
      return safeNextPath(next, AUTH_ROUTES.home);
    default:
      return `${AUTH_ROUTES.blocked}?motivo=${BLOCKED_REASON[result.state] ?? "sem-acesso"}`;
  }
}

/** Motivos que a tela /acesso sabe explicar (o parâmetro só escolhe o texto). */
export const BLOCKED_MESSAGES: Record<string, { title: string; body: string }> = {
  "conta-inativa": {
    title: "Conta inativa",
    body: "Seu acesso ao DG Brasil está desativado. Se acredita que é um engano, fale com a administração do escritório.",
  },
  "sem-acesso": {
    title: "Acesso não liberado",
    body: "Sua conta não tem um vínculo ativo com nenhum escritório. Fale com quem enviou seu convite.",
  },
  "escritorio-suspenso": {
    title: "Escritório sem acesso",
    body: "O acesso do seu escritório ao DG Brasil está suspenso. Fale com a administração da Bárbara Cardoso Advocacia.",
  },
  "escritorio-pendente": {
    title: "Escritório em ativação",
    body: "O acesso do seu escritório ainda está sendo ativado pelo administrador do escritório. Tente novamente mais tarde.",
  },
  "convite-invalido": {
    title: "Convite inválido",
    body: "Este link de convite não é válido para a sua conta. Peça um novo convite a quem convidou você.",
  },
  "convite-expirado": {
    title: "Convite expirado",
    body: "Este convite expirou. Peça um novo convite a quem convidou você.",
  },
  "convite-revogado": {
    title: "Convite cancelado",
    body: "Este convite foi cancelado. Se ainda precisa de acesso, peça um novo convite.",
  },
  "link-invalido": {
    title: "Link inválido ou expirado",
    body: "O link usado não é mais válido. Peça um novo e-mail de acesso ou de recuperação de senha.",
  },
  "conflito-de-vinculo": {
    title: "Conta já vinculada",
    body: "Esta conta já tem acesso ativo por outro escritório. Fale com a administração para ajustar o vínculo.",
  },
};
