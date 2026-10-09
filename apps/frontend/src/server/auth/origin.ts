import "server-only";

import { headers } from "next/headers";
import { HOSTS, audienceForHost } from "@/lib/hosts";
import { audienceOf, type Role } from "@/lib/permissions";

/**
 * Origem para links enviados por e-mail (convite, recuperação).
 *
 * Em produção, o link vai SEMPRE para o host da superfície do papel
 * (app.* ou portal.*), configurado por ambiente — nunca para um host vindo
 * da requisição, que poderia ser forjado (Host header injection). Em
 * localhost/preview (host desconhecido), usa a origem local.
 * O destino também precisa estar na lista de Redirect URLs do Supabase Auth.
 */
export async function emailLinkOrigin(role: Role): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const hostname = host.split(":")[0];
  const local = hostname === "localhost" || hostname === "127.0.0.1";
  if (local) return `http://${host}`;
  if (!audienceForHost(hostname)) {
    const configured = process.env.AUTH_FALLBACK_SITE_URL;
    if (configured) return configured.replace(/\/$/, "");
  }
  return `https://${HOSTS[audienceOf(role) ?? "OWNER"]}`;
}
