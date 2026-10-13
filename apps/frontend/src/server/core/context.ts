import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSession } from "@/lib/auth/types";
import { can, type Permission } from "@/lib/permissions";
import { forbidden } from "./errors";
import { createLogger, type Logger } from "./logger";

/**
 * Contexto de uma operação de domínio. Services e repositories recebem SÓ
 * isto — não importam nada do Next.js, então rodam igual na Server Action e no
 * teste de integração (com um client autenticado de verdade).
 *
 * - `db`: client Supabase com o JWT do USUÁRIO (RLS vale sempre). Nunca a
 *   service role: quando uma operação precisa dela, o service recebe o client
 *   admin explicitamente (ver docs/backend.md, "Service role").
 * - `session`: identidade validada no servidor (getCurrentSession). Papel,
 *   escritório e usuário vêm daqui — nunca do input do navegador.
 * - `requestId`: correlation ID (UUID, sem PII); vai para log e auditoria.
 */
export interface ServiceContext {
  db: SupabaseClient;
  session: AppSession;
  requestId: string;
  log: Logger;
}

export function createServiceContext(input: { db: SupabaseClient; session: AppSession; requestId: string; action?: string }): ServiceContext {
  return {
    db: input.db,
    session: input.session,
    requestId: input.requestId,
    log: createLogger({ requestId: input.requestId, action: input.action, actorId: input.session.userId }),
  };
}

/* ------------------------------------------------------------------ */
/* Decisões de autorização reutilizadas pelos services                 */
/* ------------------------------------------------------------------ */

export const isPartner = (ctx: Pick<ServiceContext, "session">) => ctx.session.surface === "PARTNER";
export const isInternal = (ctx: Pick<ServiceContext, "session">) => ctx.session.surface === "INTERNAL";
export const hasRole = (ctx: Pick<ServiceContext, "session">, ...roles: AppSession["role"][]) => roles.includes(ctx.session.role);

/** Exige a permissão da matriz central (lib/permissions). */
export function requirePermission(ctx: Pick<ServiceContext, "session">, permission: Permission): void {
  if (!can(ctx.session.role, permission)) throw forbidden();
}

/** Exige qualquer uma das permissões. */
export function requireAnyPermission(ctx: Pick<ServiceContext, "session">, ...permissions: Permission[]): void {
  if (!permissions.some((p) => can(ctx.session.role, p))) throw forbidden();
}

export function requireInternal(ctx: Pick<ServiceContext, "session">): void {
  if (!isInternal(ctx)) throw forbidden();
}

export function requireRole(ctx: Pick<ServiceContext, "session">, ...roles: AppSession["role"][]): void {
  if (!hasRole(ctx, ...roles)) throw forbidden();
}
