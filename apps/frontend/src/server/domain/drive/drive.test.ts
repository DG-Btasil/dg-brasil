import { describe, expect, it, vi } from "vitest";
import { DomainError } from "@/server/core/errors";
import { DriveClient, type DriveConfig } from "@/server/integrations/google-drive/client";
import { assertFolderAllowed, isInsideRoot } from "./folder-scope";

/**
 * Árvore de teste:
 *   RAIZ ── origemA ── bancario ── clienteJose
 *   financeiro (fora da raiz)
 *   solta (sem pasta-mãe legível)
 */
const TREE: Record<string, string[]> = {
  origemA: ["RAIZ"],
  bancario: ["origemA"],
  clienteJose: ["bancario"],
  clienteDireto: ["RAIZ"],
  financeiro: ["meuDrive"],
  meuDrive: [],
  comAtalho: ["financeiro", "bancario"],
};
const parentsOf = vi.fn(async (id: string) => {
  if (id === "solta") throw new Error("403");
  return TREE[id] ?? [];
});

const reason = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof DomainError ? [e.code, e.publicMessage] : ["?", String(e)]));

describe("pasta do Drive: só de dentro da pasta dos clientes", () => {
  it("dentro da raiz em qualquer nível; a própria raiz, pasta de fora e pasta ilegível não contam", async () => {
    expect(await isInsideRoot("clienteDireto", "RAIZ", parentsOf)).toBe(true);
    expect(await isInsideRoot("clienteJose", "RAIZ", parentsOf)).toBe(true);
    expect(await isInsideRoot("comAtalho", "RAIZ", parentsOf)).toBe(true);
    expect(await isInsideRoot("RAIZ", "RAIZ", parentsOf)).toBe(false);
    expect(await isInsideRoot("financeiro", "RAIZ", parentsOf)).toBe(false);
    expect(await isInsideRoot("solta", "RAIZ", parentsOf)).toBe(false);
    // Fundo demais: para de subir e conta como fora.
    expect(await isInsideRoot("clienteJose", "RAIZ", parentsOf, 2)).toBe(false);
  });

  it("ciclo de pastas-mãe não trava a conferência", async () => {
    const loop = vi.fn(async (id: string) => (id === "a" ? ["b"] : ["a"]));
    expect(await isInsideRoot("a", "RAIZ", loop)).toBe(false);
    expect(loop.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("pasta de dentro da DG BRASIL: advogado e administrador ligam", async () => {
    for (const role of ["ADMIN", "LAWYER"]) {
      expect(await assertFolderAllowed({ role, folderId: "clienteJose", rootFolderId: "RAIZ", parentsOf })).toBe("INSIDE_ROOT");
    }
  });

  it("pasta de fora da DG BRASIL: ninguém liga, nem o administrador (18/11/2026)", async () => {
    for (const role of ["ADMIN", "LAWYER"]) {
      expect(await reason(assertFolderAllowed({ role, folderId: "financeiro", rootFolderId: "RAIZ", parentsOf }))).toEqual([
        "FORBIDDEN",
        "Esta pasta fica fora da pasta DG BRASIL. O DG Brasil só liga pastas que estão dentro dela, nem o administrador liga pasta de fora.",
      ]);
    }
  });

  it("sem a pasta DG BRASIL configurada, ninguém liga nada", async () => {
    for (const role of ["ADMIN", "LAWYER"]) {
      expect((await reason(assertFolderAllowed({ role, folderId: "clienteJose", rootFolderId: undefined, parentsOf })))?.[0]).toBe("INVALID_STATE");
    }
  });

  it("a própria DG BRASIL nunca é ligada a um cliente", async () => {
    for (const role of ["ADMIN", "LAWYER"]) {
      expect((await reason(assertFolderAllowed({ role, folderId: "RAIZ", rootFolderId: "RAIZ", parentsOf })))?.[0]).toBe("BUSINESS_RULE");
    }
  });

  it("cliente do Drive: pede só o campo parents da pasta", async () => {
    const cfg: DriveConfig = { auth: { mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" }, rootFolderId: "RAIZ" };
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const fetchFn = vi.fn(async (url: string | URL | Request) => (String(url).includes("oauth2") ? json({ access_token: "tok", expires_in: 3600 }) : json({ parents: ["bancario"] })));
    const c = new DriveClient(cfg, fetchFn as unknown as typeof fetch);
    expect(await c.parents("cliente/Jose")).toEqual(["bancario"]);
    const called = String(fetchFn.mock.calls[1]![0]);
    expect(called).toContain("/files/cliente%2FJose?fields=parents&supportsAllDrives=true");
  });
});
