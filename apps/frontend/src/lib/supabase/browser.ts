"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "./config";

let client: SupabaseClient | undefined;

/**
 * Client do navegador: login, MFA e recuperação de senha acontecem aqui, para
 * o Supabase ver o IP real de quem tenta (limites de taxa por IP) e gravar a
 * sessão nos cookies que o servidor lê. Nenhum token vai para localStorage.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = supabasePublicConfig();
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
