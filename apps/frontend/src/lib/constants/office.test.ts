import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_OFFICE_NAME } from "./office";

/**
 * A dona do escritório confirmou a grafia "Barbara Cardoso Advocacia", sem
 * acento. Estes testes falham se o nome voltar a ser escrito com acento no
 * painel ou nos modelos de e-mail.
 */

const ROOT = resolve(__dirname, "../../../../..");
const FRONT_SRC = join(ROOT, "apps/frontend/src");
const TEMPLATES = join(ROOT, "supabase/templates");

/**
 * Onde o acento continua de propósito:
 * - termos e política: o texto definitivo depende da dona do escritório;
 * - importação: o teste confere que "barbara" encontra a pessoa "Bárbara".
 */
const ALLOWED = ["apps/frontend/src/lib/auth/legal-documents.ts", "apps/frontend/src/server/domain/imports/imports.test.ts", "apps/frontend/src/lib/constants/office.test.ts"];

function files(dir: string, ext: RegExp): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(files(path, ext));
    else if (ext.test(name)) out.push(path);
  }
  return out;
}

describe("nome do escritório", () => {
  it("a constante usa a grafia confirmada", () => {
    expect(OWNER_OFFICE_NAME).toBe("Barbara Cardoso Advocacia");
  });

  it("painel e modelos de e-mail não escrevem o nome com acento", () => {
    const offenders: string[] = [];
    for (const file of [...files(FRONT_SRC, /\.(ts|tsx)$/), ...files(TEMPLATES, /\.(html|mjs)$/)]) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.includes(rel)) continue;
      readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/B[áÁ]RBARA/i.test(line)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
