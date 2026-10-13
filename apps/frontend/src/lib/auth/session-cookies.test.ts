import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateSession } from "./evaluate";
import { LEGAL_DOCUMENTS } from "./legal-documents";
import { REMEMBER_COOKIE, REMEMBER_MAX_AGE, rememberEnabled, type CookieLifetimeOptions, rememberPreferenceCookie, withSessionLifetime } from "./session-cookies";
import type { SessionContextRow } from "./types";

const ssrDefaults: CookieLifetimeOptions = { path: "/", sameSite: "lax", httpOnly: false, maxAge: REMEMBER_MAX_AGE };

describe("Lembrar de mim: só a duração dos cookies da sessão", () => {
  it("lembrar: mantém os 400 dias do @supabase/ssr", () => {
    expect(withSessionLifetime(ssrDefaults, true, false)).toEqual(ssrDefaults);
  });
  it("não lembrar: cookie de navegador (sem maxAge/expires)", () => {
    const out = withSessionLifetime({ ...ssrDefaults, expires: new Date(Date.now() + 1e9) }, false, false);
    expect(out).not.toHaveProperty("maxAge");
    expect(out).not.toHaveProperty("expires");
    expect(out).toMatchObject({ path: "/", sameSite: "lax" });
  });
  it("remoção (logout, limpeza de pedaços) passa intacta nos dois modos", () => {
    for (const remember of [true, false]) {
      expect(withSessionLifetime({ ...ssrDefaults, maxAge: 0 }, remember, false).maxAge).toBe(0);
    }
  });
  it("HTTPS: sempre secure", () => {
    expect(withSessionLifetime(ssrDefaults, false, true).secure).toBe(true);
    expect(withSessionLifetime(ssrDefaults, true, true).secure).toBe(true);
  });
  it("só o valor exato '1' liga a preferência", () => {
    expect(rememberEnabled("1")).toBe(true);
    for (const v of [undefined, null, "", "0", "true", "aal2", "1; aal=aal2"]) expect(rememberEnabled(v)).toBe(false);
  });
  it("cookie da preferência: ligar = 400 dias; desligar = apagar", () => {
    expect(rememberPreferenceCookie(true, true)).toBe(`${REMEMBER_COOKIE}=1; Path=/; Max-Age=${REMEMBER_MAX_AGE}; SameSite=Lax; Secure`);
    expect(rememberPreferenceCookie(false, false)).toBe(`${REMEMBER_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });
});

describe("nenhuma preferência do navegador transforma aal1 em aal2", () => {
  const ctx: SessionContextRow = {
    user_id: "u1",
    email: "ana@dgbrasil.test",
    profile: { full_name: "Ana Teste", preferred_name: null, job_title: null, active: true },
    membership: { id: "m1", role: "ADMIN", status: "ACTIVE", organization: { id: "o1", type: "OWNER", name: "X", status: "ACTIVE", deleted: false } },
    legal_acceptances: LEGAL_DOCUMENTS.map((d) => ({ document_type: d.type, document_version: d.version })),
    aal: "aal1",
  };

  it("a decisão só recebe o contexto do banco e o AAL do JWT (sem preferência)", () => {
    expect(evaluateSession.length).toBe(2);
    expect(evaluateSession(ctx, { currentLevel: "aal1", hasVerifiedFactor: true }).state).toBe("MFA_VERIFY");
    expect(evaluateSession(ctx, { currentLevel: "aal2", hasVerifiedFactor: true }).state).toBe("READY");
  });

  it("a preferência só aparece nos pontos que gravam cookie (duração) e no login/logout", () => {
    const ROOT = resolve(__dirname, "../../..");
    const SRC = join(ROOT, "src");
    const allowed = new Set([
      "src/lib/auth/session-cookies.ts",
      "src/lib/supabase/server.ts",
      "src/lib/supabase/browser.ts",
      "src/proxy.ts",
      "src/features/auth/components/login-screen.tsx",
      "src/server/auth/actions.ts",
    ]);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
      });
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      const source = readFileSync(file, "utf8");
      const uses = /REMEMBER_COOKIE|rememberEnabled|dg-lembrar/.test(source);
      if (uses && !allowed.has(rel)) offenders.push(rel);
      // Nos permitidos, a preferência só serve para duração de cookie (ou ser gravada/apagada).
      if (uses && allowed.has(rel) && rel !== "src/lib/auth/session-cookies.ts") {
        expect(/withSessionLifetime|rememberPreferenceCookie|\.delete\(REMEMBER_COOKIE\)/.test(source), rel).toBe(true);
        expect(/aal2|currentLevel|evaluateSession|can\(/.test(source.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), `${rel} mistura preferência com decisão de acesso`).toBe(false);
      }
    }
    expect(offenders, "preferência 'lembrar' lida fora dos pontos de cookie").toEqual([]);
  });
});
