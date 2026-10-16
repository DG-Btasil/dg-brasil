import { describe, expect, it } from "vitest";
import {
  ALL_ROLES,
  OWNER_PERMISSIONS,
  PARTNER_PORTAL_PERMISSIONS,
  ROLE_PERMISSIONS,
  audienceOf,
  can,
  type Permission,
  type Role,
} from "./index";

/** Matriz esperada para as permissões que protegem Auth e dados sensíveis. */
const EXPECTED: Record<string, Role[]> = {
  "settings.team.manage": ["ADMIN"],
  "partnerPortal.users.manage": ["PARTNER_ADMIN"],
  "finance.view": ["ADMIN"],
  "finance.manage": ["ADMIN"],
  "dgbrasil.view": ["ADMIN"],
  "dgbrasil.manage": ["ADMIN"],
  "audit.view": ["ADMIN"],
  "demo.tools": ["ADMIN"],
  "analyses.start": ["ADMIN", "LAWYER"],
  "cases.decide": ["ADMIN", "LAWYER"],
  "reviews.decide": ["ADMIN", "LAWYER"],
  "cases.origin.override": ["ADMIN"],
  "partnerPortal.finance.view": ["PARTNER_ADMIN"],
  "partnerPortal.view": ["PARTNER_ADMIN", "PARTNER_USER"],
  "home.view": ["ADMIN", "LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"],
};

describe("matriz central de permissões", () => {
  it("só existem os 5 papéis aprovados", () => {
    expect([...ALL_ROLES].sort()).toEqual(["ADMIN", "ASSISTANT", "LAWYER", "PARTNER_ADMIN", "PARTNER_USER"]);
  });

  for (const [permission, roles] of Object.entries(EXPECTED)) {
    it(`${permission}: somente ${roles.join(", ")}`, () => {
      for (const role of ALL_ROLES) {
        expect(can(role, permission as Permission), `${role} → ${permission}`).toBe(roles.includes(role));
      }
    });
  }

  it("papel interno nunca recebe permissão do portal do parceiro", () => {
    for (const role of ALL_ROLES.filter((r) => audienceOf(r) === "OWNER")) {
      for (const p of PARTNER_PORTAL_PERMISSIONS) expect(can(role, p), `${role} → ${p}`).toBe(false);
    }
  });

  it("parceiro só recebe permissões de leitura básicas do ambiente interno", () => {
    const allowedOwner = new Set(["home.view", "clients.view", "processes.view", "processes.caseValue.view"]);
    for (const role of ALL_ROLES.filter((r) => audienceOf(r) === "PARTNER")) {
      for (const p of OWNER_PERMISSIONS) {
        if (!allowedOwner.has(p)) expect(can(role, p), `${role} → ${p}`).toBe(false);
      }
    }
  });

  it("papel ausente ou desconhecido não tem permissão nenhuma", () => {
    expect(can(undefined, "home.view")).toBe(false);
    expect(can(null, "home.view")).toBe(false);
    expect(can("FINANCE" as Role, "home.view")).toBe(false);
  });

  it("ADMIN tem todas as permissões internas", () => {
    expect([...ROLE_PERMISSIONS.ADMIN].sort()).toEqual([...OWNER_PERMISSIONS].sort());
  });
});

describe("preferências de aviso (QA 4.3.1, BUG-07)", () => {
  it("todo papel interno edita as próprias notificações; ASSISTANT só isso das configurações", () => {
    for (const role of ["ADMIN", "LAWYER", "ASSISTANT"] as const) expect(can(role, "settings.notifications.edit")).toBe(true);
    expect(can("ASSISTANT", "settings.view")).toBe(false);
  });
});
