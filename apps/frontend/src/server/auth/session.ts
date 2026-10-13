import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { evaluateSession } from "@/lib/auth/evaluate";
import { sanitizeForLog } from "@/lib/auth/errors";
import { AUTH_ROUTES, destinationFor, safeNextPath } from "@/lib/auth/redirects";
import { resolveAppSurface } from "@/lib/auth/surface";
import type { AppSession, ClientSession, MfaStatus, SessionContextRow, SessionResult } from "@/lib/auth/types";
import { can, type Permission } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Fonte ÚNICA da identidade no servidor. Uma vez por requisição (React
 * `cache`), sem confiar só no JWT local:
 *
 *   1. `auth.getUser()` valida a sessão no servidor do Auth;
 *   2. nível de autenticação (aal1/aal2) e fatores TOTP verificados;
 *   3. `get_my_session_context()` — perfil, vínculo, organização e termos,
 *      lidos AGORA do banco. Papel trocado, perfil inativado ou escritório
 *      suspenso valem na próxima requisição, sem esperar o token expirar.
 *
 * Nenhuma rota reimplementa isso: todas chamam os helpers abaixo.
 */
export const getCurrentSession = cache(async (): Promise<SessionResult> => {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { state: "ANONYMOUS" };

  const [{ data: aal }, { data: factors }, { data: ctx, error: ctxError }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    supabase.rpc("get_my_session_context"),
  ]);
  if (ctxError) {
    console.error("[auth] contexto de sessão indisponível", sanitizeForLog(ctxError));
    return { state: "PROFILE_MISSING", userId: userData.user.id };
  }

  const mfa: MfaStatus = {
    currentLevel: (aal?.currentLevel as MfaStatus["currentLevel"]) ?? null,
    hasVerifiedFactor: (factors?.totp ?? []).some((f) => f.status === "verified"),
  };
  return { ...evaluateSession(ctx as SessionContextRow | null, mfa), mfa };
});

/** Página atual, para devolver a pessoa a ela depois do login/onboarding. */
async function currentPath(): Promise<string | null> {
  return (await headers()).get("x-dg-pathname");
}

/**
 * Acesso à aplicação liberado (conta válida + termos + MFA aal2). Senão,
 * redireciona para o passo que falta. Também corrige a superfície pelo host:
 * parceiro em app.* vai para portal.*, equipe interna em portal.* vai para app.*.
 */
export async function requireAppSession(): Promise<AppSession> {
  const result = await getCurrentSession();
  if (result.state !== "READY" || !result.session) redirect(destinationFor(result, await currentPath()));

  const session = result.session;
  const host = (await headers()).get("host")?.split(":")[0];
  const { redirectToHost } = resolveAppSurface(host, session.role);
  // Caminho sempre saneado: um valor como "@evil.com" mudaria o host do destino.
  if (redirectToHost) redirect(`https://${redirectToHost}${safeNextPath(await currentPath(), AUTH_ROUTES.home)}`);
  return session;
}

/** Usuário logado (qualquer estado de onboarding). Para as telas de onboarding. */
export async function requireAuthenticatedUser(): Promise<SessionResult> {
  const result = await getCurrentSession();
  if (result.state === "ANONYMOUS") redirect(destinationFor(result, await currentPath()));
  return result;
}

export async function requirePermission(permission: Permission): Promise<AppSession> {
  const session = await requireAppSession();
  if (!can(session.role, permission)) redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

export async function requireInternalUser(): Promise<AppSession> {
  const session = await requireAppSession();
  if (session.surface !== "INTERNAL") redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

export async function requireAdmin(): Promise<AppSession> {
  const session = await requireAppSession();
  if (session.role !== "ADMIN") redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

export async function requireLawyerOrAdmin(): Promise<AppSession> {
  const session = await requireAppSession();
  if (session.role !== "ADMIN" && session.role !== "LAWYER") redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

export async function requirePartnerUser(): Promise<AppSession> {
  const session = await requireAppSession();
  if (session.surface !== "PARTNER") redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

export async function requirePartnerAdmin(): Promise<AppSession> {
  const session = await requireAppSession();
  if (session.role !== "PARTNER_ADMIN") redirect(`${AUTH_ROUTES.home}?negado=1`);
  return session;
}

/* ------------------------------------------------------------------ */
/* Server Actions: não redirecionam, devolvem erro                     */
/* ------------------------------------------------------------------ */

export class AuthorizationError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Para Server Actions e Route Handlers: exige acesso liberado (MFA + termos) e,
 * se informado, a permissão. Lança AuthorizationError (a action converte em
 * mensagem); nunca confia em papel vindo do navegador.
 */
export async function authorizeAction(permission?: Permission): Promise<AppSession> {
  const result = await getCurrentSession();
  if (result.state !== "READY" || !result.session) {
    throw new AuthorizationError("Sua sessão não está liberada. Entre novamente.");
  }
  if (permission && !can(result.session.role, permission)) throw new AuthorizationError();
  return result.session;
}

/** Recorte da sessão que pode ir ao navegador. */
export function toClientSession(session: AppSession): ClientSession {
  return {
    userId: session.userId,
    email: session.email,
    fullName: session.fullName,
    displayName: session.displayName,
    jobTitle: session.jobTitle,
    organizationId: session.organizationId,
    organizationType: session.organizationType,
    organizationName: session.organizationName,
    role: session.role,
    surface: session.surface,
  };
}
