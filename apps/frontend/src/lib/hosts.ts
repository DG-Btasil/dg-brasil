import { useSyncExternalStore } from "react";
import type { Audience } from "@/lib/permissions";

/**
 * Domínios do mesmo app (uma única base de código e um único deploy):
 * - app.barbaracardoso.adv.br    → ambiente interno (Bárbara Cardoso Advocacia)
 * - portal.barbaracardoso.adv.br → portal dos escritórios parceiros
 * Configuráveis por ambiente. O domínio só ajusta textos e atalhos do login:
 * quem decide o acesso é o papel do usuário (validado no backend), nunca o host.
 */
export const HOSTS: Record<Audience, string> = {
  OWNER: process.env.NEXT_PUBLIC_APP_HOST ?? "app.barbaracardoso.adv.br",
  PARTNER: process.env.NEXT_PUBLIC_PORTAL_HOST ?? "portal.barbaracardoso.adv.br",
};

/** Público associado ao host; undefined em localhost/preview (mostra os dois). */
export function audienceForHost(hostname: string | undefined): Audience | undefined {
  if (!hostname) return undefined;
  const host = hostname.toLowerCase();
  if (host === HOSTS.PARTNER || host.startsWith("portal.")) return "PARTNER";
  if (host === HOSTS.OWNER || host.startsWith("app.")) return "OWNER";
  return undefined;
}

const noop = () => () => {};

/** Público do host atual (cliente). No servidor: undefined. */
export function useHostAudience(): Audience | undefined {
  return useSyncExternalStore(
    noop,
    () => audienceForHost(window.location.hostname),
    () => undefined,
  );
}
