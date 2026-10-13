import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EMAIL_METADATA_KEYS } from "./invite-metadata";

/**
 * Trava de segurança: `user_metadata` do Supabase Auth é editável pelo próprio
 * usuário e só existe para o TEXTO dos e-mails. Estes testes falham se algum
 * código passar a LER esses dados (autorização tem de vir do banco:
 * organization_memberships / RLS) ou se um template usar chave não declarada.
 */

const ROOT = resolve(__dirname, "../../../../..");
const FRONT_SRC = join(ROOT, "apps/frontend/src");
const WORKER_SRC = join(ROOT, "apps/agentes/src");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const TEMPLATES = join(ROOT, "supabase/templates");

function files(dir: string, ext: RegExp): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(files(path, ext));
    else if (ext.test(name)) out.push(path);
  }
  return out;
}

/** Linhas de código (sem comentários de linha/bloco). */
function codeLines(source: string): { line: string; n: number }[] {
  return source
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*|--)/.test(line));
}

const SENSITIVE = /user_metadata|app_metadata|raw_user_meta_data|invite_role|invite_pending/;

/** Únicos arquivos que tocam esses dados: ESCREVEM o texto do e-mail. */
const ALLOWED_WRITERS = ["apps/frontend/src/lib/auth/invite-metadata.ts", "apps/frontend/src/server/auth/team-actions.ts"];

describe("user_metadata nunca vira autorização", () => {
  it("front e worker: só os arquivos de envio de e-mail mencionam os campos", () => {
    const offenders: string[] = [];
    for (const file of [...files(FRONT_SRC, /\.(ts|tsx)$/), ...files(WORKER_SRC, /\.(ts|mts|js|mjs)$/)]) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED_WRITERS.includes(rel) || /\.test\.(ts|tsx)$/.test(rel)) continue;
      for (const { line, n } of codeLines(readFileSync(file, "utf8"))) {
        if (SENSITIVE.test(line)) offenders.push(`${rel}:${n}  ${line.trim()}`);
      }
    }
    expect(offenders, "leitura de user_metadata fora do envio de e-mail").toEqual([]);
  });

  it("os escritores só GRAVAM (nenhuma leitura de .user_metadata/.app_metadata)", () => {
    for (const rel of ALLOWED_WRITERS) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source, rel).not.toMatch(/\.(user_metadata|app_metadata)\b/);
    }
  });

  it("migrations: só o nome completo é lido de raw_user_meta_data (criação do perfil)", () => {
    const offenders: string[] = [];
    const migrations = files(MIGRATIONS, /\.sql$/);
    expect(migrations.length).toBeGreaterThan(20);
    for (const file of migrations) {
      for (const { line, n } of codeLines(readFileSync(file, "utf8"))) {
        const withoutFullName = line.replace(/raw_user_meta_data\s*->>\s*'full_name'/g, "");
        if (SENSITIVE.test(withoutFullName) || /'user_metadata'|'app_metadata'/.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${n}  ${line.trim()}`);
        }
      }
    }
    expect(offenders, "migration lendo metadata do usuário").toEqual([]);
  });
});

describe("templates de e-mail × dados enviados", () => {
  const templates = files(TEMPLATES, /\.html$/);

  it("existem os dois templates (convite e recuperação)", () => {
    expect(templates.map((f) => f.split(/[\\/]/).pop()).sort()).toEqual(["invite.html", "recovery.html"]);
  });

  it("todo `.Data.x` usado nos templates é uma chave declarada em invite-metadata.ts", () => {
    const used = new Set<string>();
    for (const file of templates) {
      for (const match of readFileSync(file, "utf8").matchAll(/\.Data\.([A-Za-z_]+)/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(0);
    const unknown = [...used].filter((key) => !(EMAIL_METADATA_KEYS as readonly string[]).includes(key));
    expect(unknown, "chave usada no template e nunca enviada pelo servidor").toEqual([]);
  });
});
