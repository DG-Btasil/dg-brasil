import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkDevProject } from "./dev-project";

/**
 * Variáveis do Supabase DEV. Lê `supabase/.env.real` (o mesmo do
 * `npm run validar:real`) ou o ambiente. Duas travas (`./dev-project.ts`):
 * recusa rodar sem DG_ENV=development e recusa se algum endereço não for do
 * projeto de desenvolvimento declarado em DG_DEV_PROJECT_REF.
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
  const guard = checkDevProject(
    { DG_ENV: get("DG_ENV"), DG_DEV_PROJECT_REF: get("DG_DEV_PROJECT_REF"), SUPABASE_URL: get("SUPABASE_URL"), DG_WORKER_DB_URL: get("DG_WORKER_DB_URL"), SUPABASE_DB_URL: get("SUPABASE_DB_URL") },
    { required: ["SUPABASE_URL"], optional: ["DG_WORKER_DB_URL", "SUPABASE_DB_URL"] },
  );
  if (!guard.ok) throw new Error(`Integração recusada: ${guard.reason} (supabase/.env.real). Nunca rode contra produção.`);
  const url = get("SUPABASE_URL");
  const anonKey = get("SUPABASE_ANON_KEY");
  const serviceKey = get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) throw new Error("Faltam SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY em supabase/.env.real.");
  // Os módulos do app (ex.: Storage de documentos) leem os nomes do app em
  // process.env; o .env.real usa os nomes do validar:real (QA 4.3.1, TEST-03).
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= serviceKey;
  // API do computador do escritório (040): o servidor fala com o banco como dg_worker.
  const workerUrl = get("DG_WORKER_DB_URL");
  if (workerUrl) process.env.DG_WORKER_DB_URL ??= workerUrl;
  // Conferência de tabelas fechadas até para o service_role (judicial, 043).
  const adminUrl = get("SUPABASE_DB_URL");
  if (adminUrl) process.env.SUPABASE_DB_URL ??= adminUrl;
  return { url, anonKey, serviceKey };
}
