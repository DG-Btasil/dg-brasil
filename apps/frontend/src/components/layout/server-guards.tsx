import "server-only";

import type { ReactNode } from "react";
import { can, type Permission } from "@/lib/permissions";
import { requireAppSession } from "@/server/auth/session";
import { AccessDenied } from "./guards";

/**
 * Guards de PÁGINA, no servidor. O papel vem de requireAppSession (banco +
 * Auth, nesta requisição) — nunca do navegador. Sem permissão, o conteúdo
 * protegido nem é renderizado nem enviado ao cliente.
 */
export async function RequirePermission({ permission, children, fallback }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const session = await requireAppSession();
  if (!can(session.role, permission)) return <>{fallback ?? <AccessDenied />}</>;
  return <>{children}</>;
}

/** Monta a árvore do público certo (interno ou portal do parceiro); a outra nem é enviada. */
export async function AudienceSwitch({ owner, partner }: { owner: ReactNode; partner: ReactNode }) {
  const session = await requireAppSession();
  return <>{session.surface === "PARTNER" ? partner : owner}</>;
}
