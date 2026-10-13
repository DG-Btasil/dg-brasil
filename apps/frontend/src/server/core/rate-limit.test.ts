import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { createLogger } from "./logger";
import { PARTNER_TAX_ID_LIMITS, RATE_LIMITED_MESSAGE, SlidingWindowLimiter, enforcePartnerTaxIdLimit, partnerTaxIdRules } from "./rate-limit";

const ctx = (surface: "PARTNER" | "INTERNAL", userId: string, organizationId: string) =>
  ({ session: { surface, userId, organizationId }, log: createLogger() }) as unknown as Parameters<typeof enforcePartnerTaxIdLimit>[0];

describe("limite de taxa (best-effort, na aplicação)", () => {
  it("padrões documentados: 10/min por usuário, 30/min por escritório", () => {
    expect(PARTNER_TAX_ID_LIMITS).toMatchObject({ windowMs: 60_000, perUser: 10, perOrganization: 30 });
  });

  it("abaixo do limite passa; excedeu bloqueia; a janela desliza", () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(60_000, () => t);
    const rules = [{ key: "u", limit: 3 }];
    for (let i = 0; i < 3; i++) expect(limiter.consume(rules).allowed).toBe(true);
    const blocked = limiter.consume(rules);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterMs).toBe(60_000);
    t = 60_001; // o primeiro uso saiu da janela
    expect(limiter.consume(rules).allowed).toBe(true);
  });

  it("uso manual normal de um parceiro não é bloqueado", () => {
    let t = 0;
    const limiter = new SlidingWindowLimiter(60_000, () => t);
    const c = ctx("PARTNER", "u1", "orgA");
    // 10 consultas espaçadas ao longo de 2 minutos (1 a cada 12 s): nenhuma bloqueada.
    for (let i = 0; i < 10; i++) {
      t = i * 12_000;
      expect(() => enforcePartnerTaxIdLimit(c, limiter)).not.toThrow();
    }
  });

  it("usuário diferente tem contador próprio; o escritório soma os usuários", () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 0);
    const limits = { windowMs: 60_000, perUser: 2, perOrganization: 3 };
    const use = (userId: string, org: string) => limiter.consume(partnerTaxIdRules({ userId, organizationId: org }, limits)).allowed;
    expect([use("a", "o1"), use("a", "o1"), use("a", "o1")]).toEqual([true, true, false]); // limite do usuário
    expect(use("b", "o1")).toBe(true); // outro usuário, mesmo escritório: 3º uso do escritório
    expect(use("c", "o1")).toBe(false); // escritório no limite
    expect(use("d", "o2")).toBe(true); // outro escritório: independente
  });

  it("parceiro que excede recebe RATE_LIMITED com mensagem amigável; equipe interna não é limitada aqui", () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 0);
    const partner = ctx("PARTNER", "u9", "org9");
    for (let i = 0; i < PARTNER_TAX_ID_LIMITS.perUser; i++) enforcePartnerTaxIdLimit(partner, limiter);
    const error = (() => {
      try {
        enforcePartnerTaxIdLimit(partner, limiter);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("RATE_LIMITED");
    expect((error as DomainError).publicMessage).toBe(RATE_LIMITED_MESSAGE);
    const internal = ctx("INTERNAL", "i1", "owner");
    for (let i = 0; i < 50; i++) expect(() => enforcePartnerTaxIdLimit(internal, limiter)).not.toThrow();
  });

  it("o limitador só guarda IDs — nunca o CPF/CNPJ consultado", () => {
    const limiter = new SlidingWindowLimiter(60_000, () => 0);
    enforcePartnerTaxIdLimit(ctx("PARTNER", "user-1", "org-1"), limiter);
    expect(limiter.keys().sort()).toEqual(["partner-tax-id:org:org-1", "partner-tax-id:user:user-1"]);
    expect(limiter.keys().join()).not.toMatch(/\d{11}|\d{14}/);
  });
});
