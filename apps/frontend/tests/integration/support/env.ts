import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Variáveis do Supabase DEV. Lê `supabase/.env.real` (o mesmo do
 * `npm run validar:real`) ou o ambiente. Recusa rodar sem DG_ENV=development.
 */
export interface IntegrationEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
}

function loadFile(): Record<string, string> {
  const path = fileURLToPath(new URL("../../../../../supabase/.env.real", import.meta.url));
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function integrationEnv(): IntegrationEnv {
  const file = loadFile();
  const get = (k: string) => process.env[k] ?? file[k];
  if (get("DG_ENV") !== "development") {
    throw new Error("Integração recusada: DG_ENV precisa ser \"development\" (supabase/.env.real). Nunca rode contra produção.");
  }
  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_ANON_KEY");
  const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) throw new Error("Faltam SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY em supabase/.env.real.");
  // Os módulos do app (ex.: Storage de documentos) leem os nomes do app em
  // process.env; o .env.real usa os nomes do validar:real (QA 4.3.1, TEST-03).
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= serviceKey;
  return { url, anonKey, serviceKey };
}
