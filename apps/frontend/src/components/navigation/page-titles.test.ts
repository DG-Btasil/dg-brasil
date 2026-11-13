import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "./nav-config";

/**
 * Cada rota da área autenticada tem título próprio na aba do navegador
 * ("Clientes · DG Brasil"). Sem `metadata`, a aba mostra só "DG Brasil" e não
 * dá para distinguir as abas abertas. Página nova sem título faz este teste falhar.
 */

const APP = resolve(__dirname, "../../app");

function pages(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(pages(path));
    else if (name === "page.tsx") out.push(path);
  }
  return out;
}

const rel = (file: string) => relative(APP, file).replace(/\\/g, "/");

describe("título das páginas", () => {
  it("toda página da área autenticada e das telas de acesso declara o título", () => {
    const all = pages(APP);
    expect(all.length).toBeGreaterThan(40);
    const missing = all
      // A raiz só redireciona para /home ou /login.
      .filter((file) => rel(file) !== "page.tsx")
      .filter((file) => !/export const metadata\b|export (async )?function generateMetadata\b/.test(readFileSync(file, "utf8")))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("o título é texto de usuário, sem repetir o nome do sistema (o layout já acrescenta)", () => {
    for (const file of pages(APP)) {
      for (const m of readFileSync(file, "utf8").matchAll(/metadata: Metadata = \{ title: "([^"]+)" \}/g)) {
        expect(m[1], rel(file)).not.toMatch(/DG Brasil|Home/);
        expect(m[1].length, rel(file)).toBeGreaterThan(2);
      }
    }
  });

  it("a página inicial se chama Início no menu e na aba", () => {
    expect(NAV_ITEMS.filter((i) => i.key === "home").map((i) => i.label)).toEqual(["Início", "Início"]);
    expect(readFileSync(join(APP, "(app)/home/page.tsx"), "utf8")).toContain('title: "Início"');
  });
});
