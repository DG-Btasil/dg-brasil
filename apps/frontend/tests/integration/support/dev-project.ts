/**
 * Trava dos testes de integração: só rodam contra o Supabase de DESENVOLVIMENTO.
 *
 * Mesma regra de `supabase/scripts/trava-dev.mjs` (mantenha os dois iguais):
 *   1. DG_ENV=development;
 *   2. DG_DEV_PROJECT_REF = identificador do projeto de desenvolvimento, e todo
 *      endereço usado (API e banco) tem de ser desse mesmo projeto.
 * Antes bastava a primeira, que fica no mesmo arquivo das chaves.
 */

type Env = Record<string, string | undefined>;

const validRef = (ref: string | undefined): string | null => (ref && /^[a-z0-9]{15,30}$/.test(ref) ? ref : null);

/** Identificador do projeto num endereço do Supabase (API, banco direto ou pooler); null se não reconhecer. */
export function projectRef(address: string | undefined): string | null {
  if (!address?.trim()) return null;
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host.endsWith(".supabase.co")) {
    const parts = host.slice(0, -".supabase.co".length).split(".");
    if (parts.length === 1) return validRef(parts[0]);
    if (parts.length === 2 && parts[0] === "db") return validRef(parts[1]);
    return null;
  }
  if (host.endsWith(".pooler.supabase.com")) {
    const user = decodeURIComponent(url.username);
    const dot = user.lastIndexOf(".");
    return dot > 0 ? validRef(user.slice(dot + 1).toLowerCase()) : null;
  }
  return null;
}

export function checkDevProject(env: Env, keys: { required: string[]; optional?: string[] }): { ok: true; ref: string } | { ok: false; reason: string } {
  if (env.DG_ENV !== "development") return { ok: false, reason: 'DG_ENV precisa ser "development"' };
  const expected = (env.DG_DEV_PROJECT_REF ?? "").trim().toLowerCase();
  if (!expected) return { ok: false, reason: "falta DG_DEV_PROJECT_REF, o identificador do projeto Supabase de desenvolvimento" };
  if (!validRef(expected)) return { ok: false, reason: "DG_DEV_PROJECT_REF não parece um identificador de projeto do Supabase" };
  if (keys.required.length === 0) return { ok: false, reason: "nenhum endereço para conferir" };
  for (const key of [...keys.required, ...(keys.optional ?? [])]) {
    const value = env[key];
    if (!value) {
      if (keys.required.includes(key)) return { ok: false, reason: `variável ausente: ${key}` };
      continue;
    }
    const ref = projectRef(value);
    if (!ref) return { ok: false, reason: `${key} não é um endereço do Supabase que dê para reconhecer` };
    if (ref !== expected) return { ok: false, reason: `${key} aponta para OUTRO projeto, não para o de desenvolvimento (DG_DEV_PROJECT_REF)` };
  }
  return { ok: true, ref: expected };
}
