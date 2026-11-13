import { describe, expect, it } from "vitest";
import { checkDevProject, projectRef } from "../../../tests/integration/support/dev-project";

/**
 * A trava dos testes de integração (`tests/integration/support/dev-project.ts`)
 * é conferida aqui, nos testes unitários, porque os de integração não rodam no
 * `npm run check` (precisam do Supabase de desenvolvimento).
 */

const DEV = "abcdefghijklmnopqrst";
const PROD = "zyxwvutsrqponmlkjihg";
const base = {
  DG_ENV: "development",
  DG_DEV_PROJECT_REF: DEV,
  SUPABASE_URL: `https://${DEV}.supabase.co`,
  DG_WORKER_DB_URL: `postgresql://dg_worker.${DEV}:senha@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`,
  SUPABASE_DB_URL: `postgresql://postgres:senha@db.${DEV}.supabase.co:5432/postgres`,
};
const keys = { required: ["SUPABASE_URL"], optional: ["DG_WORKER_DB_URL", "SUPABASE_DB_URL"] };

describe("trava dos testes de integração: só o projeto de desenvolvimento", () => {
  it("reconhece o projeto na API, no banco direto e no pooler; o resto não", () => {
    expect(projectRef(`https://${DEV}.supabase.co`)).toBe(DEV);
    expect(projectRef(`postgresql://postgres:s@db.${DEV}.supabase.co:5432/postgres`)).toBe(DEV);
    expect(projectRef(`postgresql://dg_worker.${DEV}:s@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`)).toBe(DEV);
    for (const v of [undefined, "", "texto", "http://127.0.0.1:54321", `https://${DEV}.supabase.co.exemplo.dev`, "postgresql://postgres:s@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"]) {
      expect(projectRef(v)).toBeNull();
    }
  });

  it("tudo do projeto de desenvolvimento: libera (endereço opcional pode faltar)", () => {
    expect(checkDevProject(base, keys)).toEqual({ ok: true, ref: DEV });
    expect(checkDevProject({ ...base, SUPABASE_DB_URL: undefined }, keys).ok).toBe(true);
  });

  it("sem DG_ENV=development ou sem DG_DEV_PROJECT_REF: recusa", () => {
    expect(checkDevProject({ ...base, DG_ENV: "production" }, keys)).toMatchObject({ ok: false, reason: 'DG_ENV precisa ser "development"' });
    expect(checkDevProject({ ...base, DG_DEV_PROJECT_REF: undefined }, keys)).toMatchObject({ ok: false, reason: expect.stringContaining("falta DG_DEV_PROJECT_REF") });
  });

  it("chaves de produção com DG_ENV=development (o engano que a trava evita): recusa, sem mostrar o endereço", () => {
    for (const [key, value] of [
      ["SUPABASE_URL", `https://${PROD}.supabase.co`],
      ["DG_WORKER_DB_URL", `postgresql://dg_worker.${PROD}:senha@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`],
      ["SUPABASE_DB_URL", `postgresql://postgres:senha@db.${PROD}.supabase.co:5432/postgres`],
    ] as const) {
      const r = checkDevProject({ ...base, [key]: value }, keys);
      expect(r).toMatchObject({ ok: false, reason: expect.stringContaining(`${key} aponta para OUTRO projeto`) });
      expect(JSON.stringify(r)).not.toMatch(new RegExp(`${PROD}|senha`));
    }
  });

  it("endereço obrigatório ausente ou irreconhecível: recusa", () => {
    expect(checkDevProject({ ...base, SUPABASE_URL: undefined }, keys)).toMatchObject({ ok: false, reason: "variável ausente: SUPABASE_URL" });
    expect(checkDevProject({ ...base, SUPABASE_URL: "http://127.0.0.1:54321" }, keys).ok).toBe(false);
  });
});
