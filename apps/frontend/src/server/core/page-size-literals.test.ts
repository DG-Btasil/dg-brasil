import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAllPages } from "@/lib/actions/all-pages";
import { MAX_PAGE_SIZE } from "./pagination";

/**
 * QA 4.3, BUG-04: telas pediam `pageSize: 100` e o servidor (máximo 50)
 * recusava com VALIDATION — o Financeiro inteiro parou. Os unitários não
 * renderizam páginas e a integração chama o service direto, então nada pegou.
 * Esta varredura recusa qualquer `pageSize: <número>` acima do máximo no
 * código da aplicação; listas que precisam de tudo usam `loadAllPages`.
 */

const SRC = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe("pageSize literal nunca passa do máximo do servidor (BUG-04)", () => {
  it(`nenhum arquivo pede mais de ${MAX_PAGE_SIZE} itens por página`, () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf-8");
      for (const m of text.matchAll(/pageSize:\s*(\d+)/g)) {
        if (Number(m[1]) > MAX_PAGE_SIZE) offenders.push(`${relative(SRC, file)}: pageSize ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("loadAllPages percorre as páginas, para no fim e devolve o erro da página que falhar", async () => {
    const all = Array.from({ length: 120 }, (_, i) => i);
    const asked: number[] = [];
    const page = async (n: number, size: number) => {
      asked.push(size);
      const items = all.slice((n - 1) * size, n * size);
      return { ok: true as const, data: { items, page: n, pageSize: size, total: all.length, hasMore: n * size < all.length }, requestId: `r${n}` };
    };
    const r = await loadAllPages(page);
    expect(r.ok && r.data.items).toEqual(all);
    expect(r.ok && r.data.hasMore).toBe(false);
    expect(asked.every((s) => s <= MAX_PAGE_SIZE)).toBe(true);

    const failing = await loadAllPages(async (n, size) =>
      n === 2 ? { ok: false as const, error: { code: "INTERNAL" as const, message: "x" }, requestId: "e" } : page(n, size),
    );
    expect(failing.ok).toBe(false);

    const capped = await loadAllPages(page, 2);
    expect(capped.ok && [capped.data.items.length, capped.data.hasMore]).toEqual([100, true]);
  });
});
