import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { REMEMBER_COOKIE, rememberEnabled, withSessionLifetime } from "@/lib/auth/session-cookies";
import { supabasePublicConfig } from "./config";

/**
 * Client do servidor com a sessão do USUÁRIO (cookies). Usar em Server
 * Components, Route Handlers e Server Actions. Toda consulta passa pela RLS
 * com o JWT de quem está logado — é a forma normal de falar com o banco.
 *
 * Um client por requisição (o cookie store é da requisição).
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  // cookies() primeiro: marca a rota como dinâmica (nunca pré-renderizada no build).
  const cookieStore = await cookies();
  const https = (await headers()).get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
  const { url, anonKey } = supabasePublicConfig();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        // Duração conforme "Lembrar de mim" (só duração — ver session-cookies.ts).
        const remember = rememberEnabled(cookieStore.get(REMEMBER_COOKIE)?.value);
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, withSessionLifetime(options, remember, https)));
        } catch {
          // Server Component não grava cookie: o proxy já renova a sessão a
          // cada requisição, então aqui só ignoramos.
        }
      },
    },
  });
}
