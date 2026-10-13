/**
 * "Lembrar de mim neste dispositivo" — SÓ a DURAÇÃO dos cookies da sessão.
 *
 * A sessão é sempre a do Supabase Auth (cookies sb-*, gravados pelo
 * @supabase/ssr). Esta preferência decide apenas se esses cookies:
 *   - persistem (lembrar): sobrevivem ao fechar o navegador; ao reabrir, a
 *     MESMA sessão (inclusive aal2) continua valendo enquanto o Supabase a
 *     considerar válida — sem senha nem TOTP de novo;
 *   - são de navegador (não lembrar): somem quando o navegador fecha.
 *
 * ⚠ Esta preferência NUNCA é lida para decidir acesso nem nível de MFA. Ela
 * não carrega token nem identidade: com ela, o pior que alguém consegue é
 * deixar a PRÓPRIA sessão mais curta ou mais longa. Quem decide aal1/aal2 é o
 * JWT assinado pelo Supabase (getCurrentSession / RLS). `session-cookies.test.ts`
 * trava isso.
 *
 * Por que não usar `cookieOptions.maxAge` do @supabase/ssr: a biblioteca força
 * 400 dias ao gravar. Por isso a duração é ajustada nos `setAll` (proxy,
 * servidor e navegador), sempre por esta função.
 */

export const REMEMBER_COOKIE = "dg-lembrar";
/** Mesmo limite do @supabase/ssr e dos navegadores (400 dias). */
export const REMEMBER_MAX_AGE = 400 * 24 * 60 * 60;

export interface CookieLifetimeOptions {
  maxAge?: number;
  expires?: Date;
  secure?: boolean;
  [key: string]: unknown;
}

/** A preferência está ligada? Só "1" liga; qualquer outro valor = não lembrar. */
export function rememberEnabled(value: string | undefined | null): boolean {
  return value === "1";
}

/**
 * Opções de um cookie de sessão do Supabase conforme a preferência.
 * - Remoção (maxAge 0) passa intacta: logout e limpeza de pedaços sempre valem.
 * - Sem "lembrar": tira maxAge/expires → cookie de navegador.
 * - Em HTTPS, sempre `secure`.
 * Nunca muda nome nem valor do cookie: não há como "subir" o nível da sessão.
 */
export function withSessionLifetime<T extends CookieLifetimeOptions>(options: T | undefined, remember: boolean, https: boolean): T {
  const base = { ...(options ?? {}) } as T;
  if (https) base.secure = true;
  const removal = base.maxAge === 0 || (base.expires instanceof Date && base.expires.getTime() <= Date.now());
  if (removal || remember) return base;
  delete base.maxAge;
  delete base.expires;
  return base;
}

/** `document.cookie` da preferência (ligar = 400 dias; desligar = apagar). */
export function rememberPreferenceCookie(remember: boolean, https: boolean): string {
  const secure = https ? "; Secure" : "";
  return remember
    ? `${REMEMBER_COOKIE}=1; Path=/; Max-Age=${REMEMBER_MAX_AGE}; SameSite=Lax${secure}`
    : `${REMEMBER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
