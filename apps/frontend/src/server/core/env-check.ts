import type { Logger } from "./logger";

/**
 * Conferência das variáveis de ambiente na subida do servidor
 * (`src/instrumentation.ts`). Não derruba nada: cada problema vira uma linha
 * de log com o NOME da variável e o que fazer. O valor nunca é lido para o
 * log, só conferido.
 *
 * "Produção" aqui é `DG_ENV=production` (o mesmo sinal que libera as chaves
 * pagas do Serpro). O site de teste roda no mesmo endereço e na mesma Vercel,
 * por isso `NODE_ENV` e `VERCEL_ENV` não servem para distinguir.
 *
 * A lista completa, com o que é obrigatório, opcional ou proibido em
 * produção, está em docs/deploy/producao.md, item 8.
 */

export type EnvIssueLevel = "error" | "warn";

export interface EnvIssue {
  level: EnvIssueLevel;
  variable: string;
  message: string;
}

type Env = Record<string, string | undefined>;

/** Sem estas o sistema não funciona em produção. */
export const REQUIRED_IN_PRODUCTION = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DG_WORKER_DB_URL",
  "CRON_SECRET",
] as const;

const DRIVE_OAUTH = ["GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET", "GOOGLE_DRIVE_REFRESH_TOKEN"] as const;

const has = (env: Env, key: string) => !!env[key]?.trim();

export function isProduction(env: Env = process.env): boolean {
  return env.DG_ENV === "production";
}

export function checkEnvironment(env: Env = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const production = isProduction(env);
  const add = (level: EnvIssueLevel, variable: string, message: string) => issues.push({ level, variable, message });

  if (env.DG_ENV !== "production" && env.DG_ENV !== "development") {
    // Na Vercel (ambiente Production) o sinal tem de ser explícito: sem ele não dá para saber se é o site de teste ou o de uso real.
    add(env.VERCEL_ENV === "production" ? "error" : "warn", "DG_ENV", 'Defina DG_ENV como "production" (uso real) ou "development" (teste).');
  }

  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!has(env, key)) add(production ? "error" : "warn", key, production ? "Obrigatória em produção e está ausente." : "Ausente: a parte do sistema que depende dela não funciona.");
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (supabaseUrl && production && !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(supabaseUrl)) {
    add("error", "NEXT_PUBLIC_SUPABASE_URL", "Em produção deve ser o endereço https do projeto Supabase de produção.");
  }

  const workerUrl = env.DG_WORKER_DB_URL?.trim();
  if (workerUrl) {
    let user = "";
    try {
      user = decodeURIComponent(new URL(workerUrl).username);
    } catch {
      add("error", "DG_WORKER_DB_URL", "Não é um endereço de conexão válido (postgresql://…).");
    }
    // No pooler do Supabase o usuário é "dg_worker.<ref do projeto>".
    if (user && !/^dg_worker(\.|$)/.test(user)) {
      add("error", "DG_WORKER_DB_URL", "Deve usar o login dg_worker, nunca postgres nem outro usuário.");
    }
  }

  if (has(env, "CRON_SECRET") && (env.CRON_SECRET as string).trim().length < 16) {
    add(production ? "error" : "warn", "CRON_SECRET", "Curto demais: use um texto aleatório com 16 caracteres ou mais.");
  }

  // Google Drive: opcional, mas pela metade não funciona.
  const oauthSet = DRIVE_OAUTH.filter((key) => has(env, key));
  if (!has(env, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")) {
    if (oauthSet.length > 0 && oauthSet.length < DRIVE_OAUTH.length) {
      for (const key of DRIVE_OAUTH.filter((k) => !has(env, k))) add("error", key, "Google Drive configurado pela metade: faltou esta variável.");
    }
  }
  const driveOn = has(env, "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON") || oauthSet.length === DRIVE_OAUTH.length;
  if (driveOn && !has(env, "GOOGLE_DRIVE_ROOT_FOLDER_ID")) {
    add(production ? "error" : "warn", "GOOGLE_DRIVE_ROOT_FOLDER_ID", "Indique a pasta que contém as pastas dos clientes: sem ela não há sugestão de pasta e a ligação de pasta fica restrita.");
  }
  if (!driveOn && production) add("warn", "GOOGLE_DRIVE_CLIENT_ID", "Google Drive não configurado: os documentos aprovados não são copiados para o Drive.");

  // Consulta de CPF na Receita (Serpro).
  const serproKeys = has(env, "SERPRO_CPF_CONSUMER_KEY") && has(env, "SERPRO_CPF_CONSUMER_SECRET");
  if (has(env, "SERPRO_CPF_CONSUMER_KEY") !== has(env, "SERPRO_CPF_CONSUMER_SECRET")) {
    add("error", has(env, "SERPRO_CPF_CONSUMER_KEY") ? "SERPRO_CPF_CONSUMER_SECRET" : "SERPRO_CPF_CONSUMER_KEY", "Consulta de CPF configurada pela metade: faltou esta variável.");
  }
  if (production) {
    if (env.NEXT_PUBLIC_CPF_LOOKUP === "1" && !serproKeys) add("error", "SERPRO_CPF_CONSUMER_KEY", "A tela está com a consulta de CPF ligada (NEXT_PUBLIC_CPF_LOOKUP=1), mas faltam as chaves do Serpro.");
    if (serproKeys && env.NEXT_PUBLIC_CPF_LOOKUP !== "1") add("warn", "NEXT_PUBLIC_CPF_LOOKUP", 'As chaves do Serpro estão presentes, mas a tela só consulta com NEXT_PUBLIC_CPF_LOOKUP=1.');
    // Devem estar AUSENTES em produção.
    if (env.SERPRO_CPF_TRIAL === "1" || has(env, "SERPRO_CPF_TRIAL_TOKEN")) add("error", "SERPRO_CPF_TRIAL", "Modo de demonstração do Serpro não vale em produção: remova SERPRO_CPF_TRIAL e SERPRO_CPF_TRIAL_TOKEN. (O sistema já ignora os dois.)");
    if (env.NEXT_PUBLIC_DEMO_MODE === "true") add("error", "NEXT_PUBLIC_DEMO_MODE", "Ferramentas de demonstração ligadas em produção: remova a variável e publique de novo.");
    if (has(env, "AUTH_FALLBACK_SITE_URL")) add("warn", "AUTH_FALLBACK_SITE_URL", "Só serve para endereços de prévia. Em produção deve estar ausente.");
  } else if (serproKeys) {
    add("warn", "SERPRO_CPF_CONSUMER_KEY", "As chaves pagas do Serpro estão presentes fora da produção. O sistema não as usa aqui; remova para não haver engano.");
  }

  for (const key of ["NEXT_PUBLIC_APP_HOST", "NEXT_PUBLIC_PORTAL_HOST"] as const) {
    const value = env[key]?.trim();
    if (value && !/^[a-z0-9.-]+(:\d+)?$/i.test(value)) add("error", key, "Deve ser só o nome do site (ex.: app.dgbrasil.adv.br), sem https:// e sem barra.");
  }

  if (has(env, "ERROR_WEBHOOK_URL") && !/^https?:\/\//i.test((env.ERROR_WEBHOOK_URL as string).trim())) {
    add("error", "ERROR_WEBHOOK_URL", "Deve ser um endereço http(s). Do jeito que está, o aviso de erros fica desligado.");
  }
  if (production && !has(env, "ERROR_WEBHOOK_URL")) {
    add("warn", "ERROR_WEBHOOK_URL", "Sem ela, ninguém é avisado quando o servidor registra um erro (docs/deploy/producao.md, Monitoramento).");
  }

  return issues;
}

/** Registra cada problema no log (erro ou aviso) e devolve a lista. Nunca lança. */
export function reportEnvironment(log: Pick<Logger, "error" | "warn" | "info">, env: Env = process.env): EnvIssue[] {
  try {
    const issues = checkEnvironment(env);
    for (const issue of issues) log[issue.level]("env.check", { variable: issue.variable, problem: issue.message });
    if (!issues.some((i) => i.level === "error")) log.info("env.ok", { production: isProduction(env), warnings: issues.length });
    return issues;
  } catch {
    return [];
  }
}
