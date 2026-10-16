import type { ServiceContext } from "@/server/core/context";
import { fromDbError } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { enforceAccountSecurityLimit } from "@/server/core/rate-limit";

/**
 * Segurança da PRÓPRIA conta (Etapa 4.3.2, migration 038). O Supabase Auth é a
 * fonte de verdade: uma sessão é uma linha de auth.sessions, identificada pelo
 * `session_id` do JWT. Nada aqui cria sessão paralela nem toca em refresh token.
 *
 * - Lista: `get_my_sessions()` — só as sessões do usuário do JWT, já sem o
 *   user agent cru (o banco devolve só navegador / sistema / aparelho) e sem
 *   IP. O id completo da sessão NÃO vai ao navegador (só um prefixo para a
 *   lista), porque não há o que fazer com ele: o Supabase não revoga uma
 *   sessão específica pela API oficial.
 * - Encerrar: `auth.signOut({ scope })` — "others" (todas menos esta) e
 *   "global" (todas). A auditoria vem ANTES da revogação, com o JWT ainda
 *   válido; o banco avisa a pessoa (categoria Segurança).
 */

export type DeviceClass = "DESKTOP" | "MOBILE" | "TABLET";

export interface AccountSessionDTO {
  /** Prefixo do id (só para chave de lista e conferência visual). */
  ref: string;
  current: boolean;
  createdAt: string;
  /** Última renovação do token (aproximada: o navegador renova ~1×/hora enquanto aberto). */
  lastActivityAt: string | null;
  mfaVerified: boolean;
  browser: string | null;
  operatingSystem: string | null;
  device: DeviceClass | null;
  /** "Chrome no Windows", "Safari no iPhone", "Navegador desconhecido". */
  label: string;
}

export interface AccountSecurityDTO {
  sessions: AccountSessionDTO[];
  mfa: { enabled: boolean; factors: { name: string | null; createdAt: string }[] };
}

export interface SessionRow {
  session_id: string;
  is_current: boolean;
  created_at: string;
  last_refreshed_at: string | null;
  aal: string | null;
  browser: string | null;
  operating_system: string | null;
  device_class: string | null;
}

export function deviceLabel(browser: string | null, os: string | null): string {
  if (browser && os) return `${browser} no ${os}`;
  if (browser) return browser;
  if (os) return `Navegador no ${os}`;
  return "Navegador desconhecido";
}

export function sessionFromRow(row: SessionRow): AccountSessionDTO {
  const device = (["DESKTOP", "MOBILE", "TABLET"] as const).find((d) => d === row.device_class) ?? null;
  return {
    ref: row.session_id.slice(0, 8),
    current: row.is_current,
    createdAt: row.created_at,
    lastActivityAt: row.last_refreshed_at,
    mfaVerified: row.aal === "aal2",
    browser: row.browser,
    operatingSystem: row.operating_system,
    device,
    label: deviceLabel(row.browser, row.operating_system),
  };
}

export async function getAccountSecurity(ctx: ServiceContext): Promise<AccountSecurityDTO> {
  const [sessions, factors] = await Promise.all([ctx.db.rpc("get_my_sessions"), ctx.db.auth.mfa.listFactors()]);
  if (sessions.error) throw fromDbError(sessions.error);
  // Só nome e data do fator: o segredo do TOTP nunca sai do Auth.
  const verified = (factors.data?.totp ?? []).filter((f) => f.status === "verified");
  return {
    sessions: ((sessions.data ?? []) as SessionRow[]).map(sessionFromRow),
    mfa: { enabled: verified.length > 0, factors: verified.map((f) => ({ name: f.friendly_name ?? null, createdAt: f.created_at })) },
  };
}

export type AccountSecurityEvent = "SESSION_CURRENT_REVOKED" | "OTHER_SESSIONS_REVOKED" | "ALL_SESSIONS_REVOKED" | "PASSWORD_CHANGED";

export async function recordAccountSecurityEvent(ctx: Pick<ServiceContext, "db">, action: AccountSecurityEvent): Promise<void> {
  const { error } = await ctx.db.rpc("record_account_security_event", { p_action: action });
  if (error) throw fromDbError(error);
}

const SIGN_OUT_FAILED = "Não foi possível encerrar as sessões agora. Tente novamente.";

/** Todas as sessões menos esta. Esta continua. */
export async function signOutOtherSessions(ctx: ServiceContext): Promise<void> {
  enforceAccountSecurityLimit(ctx);
  await recordAccountSecurityEvent(ctx, "OTHER_SESSIONS_REVOKED");
  const { error } = await ctx.db.auth.signOut({ scope: "others" });
  if (error) {
    ctx.log.error("account.sign_out_others_failed", { status: error.status ?? null });
    throw new DomainError("INTERNAL", SIGN_OUT_FAILED);
  }
}

/** Todas as sessões, inclusive esta. Quem chama manda para o login. */
export async function signOutAllSessions(ctx: ServiceContext): Promise<void> {
  enforceAccountSecurityLimit(ctx);
  // Antes: depois do signOut este JWT não vale mais no banco.
  await recordAccountSecurityEvent(ctx, "ALL_SESSIONS_REVOKED");
  const { error } = await ctx.db.auth.signOut({ scope: "global" });
  if (error) {
    ctx.log.error("account.sign_out_global_failed", { status: error.status ?? null });
    throw new DomainError("INTERNAL", SIGN_OUT_FAILED);
  }
}
