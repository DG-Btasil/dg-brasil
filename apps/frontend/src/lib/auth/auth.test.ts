import { describe, expect, it } from "vitest";
import { loginErrorMessage, sanitizeForLog } from "./errors";
import { evaluateSession } from "./evaluate";
import { LEGAL_DOCUMENTS, pendingLegalDocuments } from "./legal-documents";
import { passwordProblem } from "./password-policy";
import { AUTH_ROUTES, destinationFor, safeNextPath } from "./redirects";
import { resolveAppSurface, surfaceForRole } from "./surface";
import type { MfaStatus, SessionContextRow } from "./types";

const ALL_ACCEPTED = LEGAL_DOCUMENTS.map((d) => ({ document_type: d.type, document_version: d.version }));

function ctx(over: Partial<SessionContextRow> = {}, org: Partial<NonNullable<SessionContextRow["membership"]>["organization"]> = {}): SessionContextRow {
  return {
    user_id: "u1",
    email: "ana@dgbrasil.test",
    profile: { full_name: "Ana Teste", preferred_name: null, job_title: null, active: true },
    membership: {
      id: "m1",
      role: "LAWYER",
      status: "ACTIVE",
      organization: { id: "o1", type: "OWNER", name: "Bárbara Cardoso Advocacia", status: "ACTIVE", deleted: false, ...org },
    },
    legal_acceptances: ALL_ACCEPTED,
    aal: "aal2",
    ...over,
  };
}
const AAL2: MfaStatus = { currentLevel: "aal2", hasVerifiedFactor: true };

describe("evaluateSession", () => {
  it("sem contexto → ANONYMOUS", () => {
    expect(evaluateSession(null, AAL2).state).toBe("ANONYMOUS");
  });
  it("tudo certo com aal2 → READY", () => {
    const r = evaluateSession(ctx(), AAL2);
    expect(r.state).toBe("READY");
    expect(r.session?.role).toBe("LAWYER");
    expect(r.session?.surface).toBe("INTERNAL");
  });
  it("perfil ausente / inativo", () => {
    expect(evaluateSession(ctx({ profile: null }), AAL2).state).toBe("PROFILE_MISSING");
    expect(evaluateSession(ctx({ profile: { full_name: "A", preferred_name: null, job_title: null, active: false } }), AAL2).state).toBe("PROFILE_INACTIVE");
  });
  it("sem vínculo / vínculo suspenso", () => {
    expect(evaluateSession(ctx({ membership: null }), AAL2).state).toBe("NO_MEMBERSHIP");
    const c = ctx();
    c.membership!.status = "SUSPENDED";
    expect(evaluateSession(c, AAL2).state).toBe("MEMBERSHIP_INACTIVE");
  });
  it("escritório suspenso, inativo, excluído ou pendente", () => {
    expect(evaluateSession(ctx({}, { status: "SUSPENDED" }), AAL2).state).toBe("ORGANIZATION_BLOCKED");
    expect(evaluateSession(ctx({}, { status: "INACTIVE" }), AAL2).state).toBe("ORGANIZATION_BLOCKED");
    expect(evaluateSession(ctx({}, { deleted: true }), AAL2).state).toBe("ORGANIZATION_BLOCKED");
    expect(evaluateSession(ctx({}, { status: "PENDING" }), AAL2).state).toBe("ORGANIZATION_PENDING");
  });
  it("papel incompatível com o tipo do escritório nunca libera", () => {
    expect(evaluateSession(ctx({}, { type: "PARTNER" }), AAL2).state).toBe("MEMBERSHIP_INACTIVE");
  });
  it("com fator e sessão aal1 → MFA_VERIFY (antes dos termos)", () => {
    const r = evaluateSession(ctx({ legal_acceptances: [] }), { currentLevel: "aal1", hasVerifiedFactor: true });
    expect(r.state).toBe("MFA_VERIFY");
  });
  it("termos pendentes → LEGAL_PENDING; depois sem fator → MFA_ENROLL", () => {
    const noFactor: MfaStatus = { currentLevel: "aal1", hasVerifiedFactor: false };
    expect(evaluateSession(ctx({ legal_acceptances: [] }), noFactor).state).toBe("LEGAL_PENDING");
    expect(evaluateSession(ctx(), noFactor).state).toBe("MFA_ENROLL");
  });
  it("nova versão de documento exige novo aceite", () => {
    const old = ALL_ACCEPTED.map((a) => ({ ...a, document_version: "0.0-antigo" }));
    expect(pendingLegalDocuments(old)).toHaveLength(LEGAL_DOCUMENTS.length);
    expect(evaluateSession(ctx({ legal_acceptances: old }), AAL2).state).toBe("LEGAL_PENDING");
  });
  it("todo papel exige MFA: aal1 nunca vira READY", () => {
    for (const role of ["ADMIN", "LAWYER", "ASSISTANT"] as const) {
      const c = ctx();
      c.membership!.role = role;
      expect(evaluateSession(c, { currentLevel: "aal1", hasVerifiedFactor: true }).state).toBe("MFA_VERIFY");
    }
    for (const role of ["PARTNER_ADMIN", "PARTNER_USER"] as const) {
      const c = ctx({}, { type: "PARTNER" });
      c.membership!.role = role;
      expect(evaluateSession(c, { currentLevel: "aal1", hasVerifiedFactor: false }).state).toBe("MFA_ENROLL");
      expect(evaluateSession(c, AAL2).session?.surface).toBe("PARTNER");
    }
  });
});

describe("safeNextPath (anti open-redirect)", () => {
  const evil = [
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "javascript:alert(1)",
    "/%0d%0aLocation:%20https://evil.com",
    "/%2F%2Fevil.com",
    "/%5Cevil.com",
    "/%E0%A4%A",
    "/home\nhttps://evil.com",
    "evil.com",
    "@evil.com",
    "/" + "a".repeat(600),
    "/",
    "/login",
    "/seguranca/verificar",
    "/termos",
    "/auth/confirm?x=1",
  ];
  for (const raw of evil) {
    it(`rejeita ${JSON.stringify(raw.slice(0, 40))}`, () => {
      expect(safeNextPath(raw, "FALLBACK")).toBe("FALLBACK");
    });
  }
  it("aceita caminho interno com query", () => {
    expect(safeNextPath("/clientes/123?aba=docs")).toBe("/clientes/123?aba=docs");
  });
  it("normaliza ../ sem sair da origem", () => {
    expect(safeNextPath("/clientes/../financeiro")).toBe("/financeiro");
  });
  it("vazio usa o fallback padrão (/home)", () => {
    expect(safeNextPath(undefined)).toBe(AUTH_ROUTES.home);
  });
});

describe("destinationFor", () => {
  it("anônimo vai ao login preservando next seguro", () => {
    expect(destinationFor({ state: "ANONYMOUS" }, "/clientes")).toBe("/login?next=%2Fclientes");
    expect(destinationFor({ state: "ANONYMOUS" }, "https://evil.com")).toBe("/login");
  });
  it("estados de onboarding e bloqueio", () => {
    expect(destinationFor({ state: "MFA_VERIFY" })).toBe(AUTH_ROUTES.mfaVerify);
    expect(destinationFor({ state: "MFA_ENROLL" })).toBe(AUTH_ROUTES.mfaEnroll);
    expect(destinationFor({ state: "LEGAL_PENDING" })).toBe(AUTH_ROUTES.terms);
    expect(destinationFor({ state: "PROFILE_INACTIVE" })).toBe("/acesso?motivo=conta-inativa");
    expect(destinationFor({ state: "ORGANIZATION_BLOCKED" })).toBe("/acesso?motivo=escritorio-suspenso");
    expect(destinationFor({ state: "READY" }, "//evil.com")).toBe(AUTH_ROUTES.home);
  });
});

describe("superfície (interno x portal)", () => {
  it("o papel decide a superfície", () => {
    expect(surfaceForRole("ADMIN")).toBe("INTERNAL");
    expect(surfaceForRole("PARTNER_USER")).toBe("PARTNER");
  });
  it("localhost: sem redirecionamento", () => {
    expect(resolveAppSurface("localhost", "PARTNER_ADMIN")).toEqual({ surface: "PARTNER" });
  });
  it("host errado para o papel redireciona para o host certo", () => {
    expect(resolveAppSurface("app.barbaracardoso.adv.br", "PARTNER_USER").redirectToHost).toBe("portal.barbaracardoso.adv.br");
    expect(resolveAppSurface("portal.barbaracardoso.adv.br", "LAWYER").redirectToHost).toBe("app.barbaracardoso.adv.br");
    expect(resolveAppSurface("app.barbaracardoso.adv.br", "ADMIN").redirectToHost).toBeUndefined();
  });
});

describe("política de senha", () => {
  it("recusa curtas, sem variedade, óbvias e com nome/e-mail", () => {
    expect(passwordProblem("Curta1")).toMatch(/8/);
    expect(passwordProblem("Curta12")).toMatch(/8/);
    expect(passwordProblem("Tribu7aX")).toBeNull();
    expect(passwordProblem("Senha123")).toMatch(/fácil/);
    expect(passwordProblem("Admin123")).toMatch(/fácil/);
    expect(passwordProblem("somenteminusculas1")).toMatch(/maiúsculas/);
    expect(passwordProblem("DgBrasil2026")).toMatch(/fácil/);
    expect(passwordProblem("Tribunal2026x")).toBeNull();
    expect(passwordProblem("Qwerty123456".toLowerCase())).not.toBeNull();
    expect(passwordProblem("AnaPaula2026x", { email: "anapaula@dgbrasil.test" })).toMatch(/e-mail/);
    expect(passwordProblem("Joaquim2026xY", { name: "Joaquim Teste" })).toMatch(/nome/);
  });
  it("aceita senha forte", () => {
    expect(passwordProblem("Rio-Verde-2026-Azul", { email: "x@dgbrasil.test", name: "Ana Teste" })).toBeNull();
  });
});

describe("mensagens e logs", () => {
  it("login não revela se o e-mail existe", () => {
    expect(loginErrorMessage({ code: "invalid_credentials", status: 400 })).toBe("E-mail ou senha incorretos.");
    expect(loginErrorMessage({ code: "user_not_found", status: 400 })).toBe("E-mail ou senha incorretos.");
    expect(loginErrorMessage({ code: "email_not_confirmed", status: 400 })).toBe("E-mail ou senha incorretos.");
    expect(loginErrorMessage({ status: 429 })).toMatch(/tentativas/);
  });
  it("sanitizeForLog remove JWT, tokens, senhas e códigos", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
    const out = sanitizeForLog({ message: `falhou ${jwt} token_hash=abc123 password=Segredo1 code=123456 key=sk_live ref=convite987 {"refresh_token":"rt-xyz"}` });
    expect(out.message).not.toContain(jwt);
    expect(out.message).not.toContain("abc123");
    expect(out.message).not.toContain("Segredo1");
    expect(out.message).not.toContain("123456");
    expect(out.message).not.toContain("sk_live");
    expect(out.message).not.toContain("convite987");
    expect(out.message).not.toContain("rt-xyz");
  });
});
