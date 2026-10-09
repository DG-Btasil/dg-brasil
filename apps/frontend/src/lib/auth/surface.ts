import { audienceForHost, HOSTS } from "@/lib/hosts";
import { audienceOf } from "@/lib/permissions";
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
