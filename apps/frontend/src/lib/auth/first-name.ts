const TITLES = /^(dr|dra|sr|sra|srta|prof|profa)\.?$/i;

/**
 * Primeiro nome para a saudação dos e-mails do Auth ("Olá, Mariana!").
 * O template do Supabase não recorta texto, então o nome vai pronto em
 * `user_metadata.first_name`. Ignora pronomes de tratamento; vazio → "" (o
 * template cai para o nome completo ou para "Olá!").
 */
export function firstNameOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words.find((word) => !TITLES.test(word)) ?? "";
  return first.slice(0, 40);
}
