import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cadastro pessoal (079) dos usuários de TESTE: nasce concluído, para a sessão
 * sair READY e não PROFILE_PENDING. Vai pela service role, direto na tabela
 * (como o setup já faz com vínculo e termos): a etapa em si é coberta pelo
 * `npm run verificar` do banco, marca [079].
 */
export async function markProfileCompleted(service: SupabaseClient, userId: string): Promise<void> {
  const { error, count } = await service
    .from("profiles")
    .update({ office_city: "São Paulo", office_state: "SP", profile_completed_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", userId);
  if (error) throw new Error(`[setup] cadastro pessoal do usuário de teste: ${error.message}`);
  if (count !== 1) throw new Error("[setup] cadastro pessoal do usuário de teste: perfil não encontrado");
}
