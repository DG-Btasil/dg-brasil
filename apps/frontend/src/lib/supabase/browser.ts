"use client";

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REMEMBER_COOKIE, rememberEnabled, withSessionLifetime } from "@/lib/auth/session-cookies";
import { supabasePublicConfig } from "./config";

let client: SupabaseClient | undefined;

/**
 * Client do navegador: login, MFA e recuperação de senha acontecem aqui, para
 * o Supabase ver o IP real de quem tenta (limites de taxa por IP) e gravar a
 * sessão nos cookies que o servidor lê. Nenhum token vai para localStorage.
 *
 * Os cookies são gravados aqui (e não pelo padrão da biblioteca) só para
 * aplicar a duração de "Lembrar de mim" — ver lib/auth/session-cookies.ts.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = supabasePublicConfig();
    client = createBrowserClient(url, anonKey, {
      cookies: {
        getAll: () => parseCookieHeader(document.cookie).map(({ name, value }) => ({ name, value: value ?? "" })),
        setAll: (cookiesToSet) => {
          const all = parseCookieHeader(document.cookie);
          const remember = rememberEnabled(all.find((c) => c.name === REMEMBER_COOKIE)?.value);
          const https = window.location.protocol === "https:";
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookieHeader(name, value, withSessionLifetime(options, remember, https));
          }
        },
      },
    });
  }
  return client;
}
