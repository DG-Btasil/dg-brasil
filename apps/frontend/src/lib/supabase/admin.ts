import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicConfig } from "./config";

/**
 * Client ADMINISTRATIVO (service role). Ignora RLS. Só para o que exige a
 * Admin API do Auth — enviar convite, reset de MFA — e SEMPRE depois de o
 * servidor validar a sessão e o papel de quem pediu. Não é atalho de
 * autorização: as operações de domínio continuam com o client do usuário.
 *
 * `server-only` faz o build falhar se isto for importado no navegador.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente (variável só do servidor).");
  }
  const { url } = supabasePublicConfig();
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
