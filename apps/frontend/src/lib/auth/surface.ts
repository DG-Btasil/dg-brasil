import { audienceForHost, HOSTS } from "@/lib/hosts";
import { audienceOf } from "@/lib/permissions";
import { AUTH_ROUTES, safeNextPath, SURFACE_HOP_PARAM } from "./redirects";
import type { AppRole, AppSurface } from "./types";

/** Superfície que o PAPEL determina. É o que vale para acesso. */
export function surfaceForRole(role: AppRole): AppSurface {
  return audienceOf(role) === "PARTNER" ? "PARTNER" : "INTERNAL";
}

/**
 * Superfície da requisição. O host (app.* / portal.*) só escolhe a porta de
 * entrada e o visual; quem manda é o papel. Se o host não combina com o papel
 * (parceiro em app.*, equipe interna em portal.*), devolve o host certo para
 * redirecionar. Em localhost/preview o host não é reconhecido e só o papel
 * conta — o desenvolvimento não depende dos subdomínios.
 */
export function resolveAppSurface(
  hostname: string | null | undefined,
  role: AppRole,
): { surface: AppSurface; redirectToHost?: string } {
  const surface = surfaceForRole(role);
  const hostAudience = audienceForHost(hostname ?? undefined);
  if (!hostAudience) return { surface };
  const hostSurface: AppSurface = hostAudience === "PARTNER" ? "PARTNER" : "INTERNAL";
  if (hostSurface === surface) return { surface };
  return { surface, redirectToHost: surface === "PARTNER" ? HOSTS.PARTNER : HOSTS.OWNER };
}

/**
 * Para onde mandar quem está no host errado para o papel; null = host certo.
 *
 * Os cookies de sessão são por host, então app.* e portal.* podem estar com
 * contas de perfis opostos no mesmo navegador: cada host manda para o outro e o
 * navegador para em ERR_TOO_MANY_REDIRECTS. Por isso só há UM salto: ele leva
 * uma marca, e quem chega com a marca e ainda está no host errado para no
 * /acesso. Em nenhum dos casos a área autenticada é renderizada.
 */
export function surfaceRedirectPath(hostname: string | null | undefined, role: AppRole, currentPath: string | null | undefined): string | null {
  const { redirectToHost } = resolveAppSurface(hostname, role);
  if (!redirectToHost) return null;
  const hopped = new URLSearchParams((currentPath ?? "").split("?")[1] ?? "").has(SURFACE_HOP_PARAM);
  if (hopped) return `${AUTH_ROUTES.blocked}?motivo=contas-em-conflito`;
  // Caminho sempre saneado: um valor como "@evil.com" mudaria o host do destino.
  const path = safeNextPath(currentPath, AUTH_ROUTES.home);
  return `https://${redirectToHost}${path}${path.includes("?") ? "&" : "?"}${SURFACE_HOP_PARAM}=1`;
}
