/**
 * Política de senha do DG Brasil (sistema jurídico, dado sigiloso).
 *
 * Aplicada em DOIS lugares: aqui (mensagem clara antes de enviar, e de novo no
 * servidor) e no Supabase Auth (supabase/config.toml: minimum_password_length
 * e password_requirements; proteção contra senha vazada no painel). O Auth é a
 * barreira final — esta função só evita ida e volta e explica o motivo.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Comparadas em minúsculas (ex.: "Senha123" cai em "senha123"). */
const OBVIAS = new Set([
  "senha123",
  "senha1234",
  "senha12345",
  "password1",
  "password123",
  "qwerty12",
  "qwerty123",
  "abc12345",
  "abcd1234",
  "mudar123",
  "admin123",
  "brasil123",
  "dgbrasil1",
  "dgbrasil123",
  "barbara123",
  "123456789012",
  "senha1234567",
  "senhasenha12",
  "qwerty123456",
  "dgbrasil2026",
  "advocacia123",
  "barbaracardoso",
]);

export const PASSWORD_HINT =
  `Mínimo de ${PASSWORD_MIN_LENGTH} caracteres, com letras maiúsculas, minúsculas e números. Não use seu nome nem seu e-mail.`;

export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Use letras maiúsculas, minúsculas e números.";
  }
  const lower = password.toLowerCase();
  if (OBVIAS.has(lower) || /^(.)\1+$/.test(password)) return "Essa senha é fácil demais de adivinhar.";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "Não use seu e-mail na senha.";
  const nomes = (context.name ?? "").toLowerCase().split(/\s+/).filter((n) => n.length >= 4);
  if (nomes.some((n) => lower.includes(n))) return "Não use seu nome na senha.";
  return null;
}
