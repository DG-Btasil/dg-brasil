import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/core/logger";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import { SETUP_CODE, newSetupCode, setupCodeHash, setupCommand, setupOrigin } from "@/server/domain/account/setup";
import { handleSetupRedeem } from "./redeem";

const ROW = { version: "2026.11.14-101500", storage_object_name: "org/2026.11.14-101500.zip", size_bytes: "2048", checksum_sha256: "d".repeat(64) };

function deps(redeem: (hash: string) => Promise<typeof ROW> = async () => ROW) {
  const silent = createLogger();
  return {
    redeem: vi.fn(redeem),
    sign: vi.fn(async () => "https://storage.test/setup.zip?token=s"),
    log: { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    limiter: new SlidingWindowLimiter(60_000),
  };
}

describe("setup do escritório (072): código e comando", () => {
  it("o código tem o formato esperado e muda a cada pedido", () => {
    const a = newSetupCode();
    expect(SETUP_CODE.test(a)).toBe(true);
    expect(newSetupCode()).not.toBe(a);
    expect(setupCodeHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("o comando chama o setup.ps1 do próprio site e leva só o código", () => {
    const code = newSetupCode();
    const cmd = setupCommand("https://app.dgbrasil.adv.br", code);
    expect(cmd).toBe(`$env:DG_SETUP_CODE='${code}'; $env:DG_BRASIL_URL='https://app.dgbrasil.adv.br'; irm 'https://app.dgbrasil.adv.br/executor/setup.ps1' | iex`);
    expect(cmd).not.toMatch(/dgx_/);
  });

  it("comando recusa código ou endereço fora do formato (nada de aspas no comando)", () => {
    expect(() => setupCommand("https://app.dgbrasil.adv.br", "dgs_'; rm -rf")).toThrow();
    expect(() => setupCommand("https://x.com'; calc", newSetupCode())).toThrow();
  });

  it("endereço: https no site, http só em localhost; host estranho recusado", () => {
    expect(setupOrigin("app.dgbrasil.adv.br", "https")).toBe("https://app.dgbrasil.adv.br");
    expect(setupOrigin("app.dgbrasil.adv.br", "http")).toBe("https://app.dgbrasil.adv.br");
    expect(setupOrigin("localhost:3000", "http")).toBe("http://localhost:3000");
    expect(() => setupOrigin("x.com'; calc", "https")).toThrow();
    expect(() => setupOrigin(null, "https")).toThrow();
  });
});

describe("setup do escritório (072): /api/setup/v1/baixar", () => {
  it("código válido: o banco recebe só o hash e a resposta traz a URL assinada do pacote", async () => {
    const d = deps();
    const code = newSetupCode();
    const r = await handleSetupRedeem({ code }, "1.2.3.4", d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ version: ROW.version, size: 2048, sha256: ROW.checksum_sha256, url: "https://storage.test/setup.zip?token=s", expires_in: 120 });
    expect(d.redeem).toHaveBeenCalledWith(setupCodeHash(code));
    expect(d.sign).toHaveBeenCalledWith(ROW.storage_object_name, `setup-dg-brasil-${ROW.version}.zip`);
    expect(JSON.stringify(r.body)).not.toContain(code);
  });

  it("formato errado não chega ao banco", async () => {
    const d = deps();
    for (const body of [{}, { code: "dgx_" + "a".repeat(43) }, { code: 12 }, null]) {
      expect((await handleSetupRedeem(body, "1.2.3.4", d)).status).toBe(401);
    }
    expect(d.redeem).not.toHaveBeenCalled();
  });

  it("vencido ou já usado: 401 com a frase para baixar outro; erro interno não vaza", async () => {
    const usado = deps(async () => { throw Object.assign(new Error("Este setup venceu"), { code: "42501" }); });
    const r = await handleSetupRedeem({ code: newSetupCode() }, "1.2.3.4", usado);
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).toMatch(/Sua conta e sessões/);
    const quebrou = deps(async () => { throw Object.assign(new Error("relation office_setup_codes does not exist"), { code: "42P01" }); });
    const e = await handleSetupRedeem({ code: newSetupCode() }, "1.2.3.4", quebrou);
    expect(e.status).toBe(500);
    expect(JSON.stringify(e.body)).not.toMatch(/office_setup_codes/);
  });

  it("muitas tentativas do mesmo IP: 429 antes do banco", async () => {
    const d = deps(async () => { throw Object.assign(new Error("x"), { code: "42501" }); });
    for (let i = 0; i < 10; i++) await handleSetupRedeem({ code: newSetupCode() }, "9.9.9.9", d);
    const r = await handleSetupRedeem({ code: newSetupCode() }, "9.9.9.9", d);
    expect(r.status).toBe(429);
    expect(d.redeem).toHaveBeenCalledTimes(10);
  });
});
