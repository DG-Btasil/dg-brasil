/**
 * Configuração PÚBLICA do Supabase (vai para o navegador).
 *
 * Só URL e chave anon/publishable. A chave anon não dá acesso a nada sozinha:
 * quem decide é a RLS com o JWT do usuário. A service role NUNCA aparece aqui
 * nem em variável NEXT_PUBLIC_* — ver `./admin.ts`.
 */
export function supabasePublicConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase não configurado: defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY (ver apps/frontend/.env.example).",
    );
  }
  return { url, anonKey };
}
