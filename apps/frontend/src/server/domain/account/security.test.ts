import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { evaluateSession } from "@/lib/auth/evaluate";
import { destinationFor, BLOCKED_MESSAGES } from "@/lib/auth/redirects";
import type { AppSession, SessionContextRow } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { deviceLabel, getAccountSecurity, sessionFromRow, signOutAllSessions, signOutOtherSessions, type SessionRow } from "./security";

const USER = "99999999-9999-4999-8999-999999999999";
const SID = "aaaaaaaa-1111-4111-8111-111111111111";

/** Client simulado: grava a ordem das chamadas (rpc de auditoria → signOut). */
function fakeDb(over: { rpc?: (name: string, args?: unknown) => unknown; signOutError?: { status: number } } = {}) {
  const calls: string[] = [];
  const db = {
    rpc: vi.fn(async (name: string, args?: { p_action?: string }) => {
      calls.push(`rpc:${name}${args?.p_action ? `:${args.p_action}` : ""}`);
      return (over.rpc?.(name, args) as object) ?? { data: null, error: null };
    }),
    auth: {
      signOut: vi.fn(async ({ scope }: { scope: string }) => {
        calls.push(`signOut:${scope}`);
        return { error: over.signOutError ?? null };
      }),
      mfa: {
        listFactors: vi.fn(async () => ({
          data: { totp: [{ id: "f1", status: "verified", friendly_name: "Celular", created_at: "2026-10-01T10:00:00Z", secret: "NUNCA" }, { id: "f2", status: "unverified", created_at: "x" }] },
          error: null,
        })),
      },
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

let n = 0;
const ctxWith = (db: SupabaseClient) =>
  // Usuário diferente a cada teste: o limite de taxa é por usuário.
  createServiceContext({ db, requestId: "r", session: { userId: `${USER.slice(0, -4)}${String(n++).padStart(4, "0")}`, role: "LAWYER", surface: "INTERNAL" } as AppSession });

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  session_id: SID,
  is_current: true,
  created_at: "2026-10-16T10:00:00Z",
  last_refreshed_at: "2026-10-16T11:00:00Z",
  aal: "aal2",
  browser: "Chrome",
  operating_system: "Windows",
  device_class: "DESKTOP",
  ...over,
});

describe("sessões da conta: DTO", () => {
  it("nome amigável sem palpite", () => {
    expect(deviceLabel("Chrome", "Windows")).toBe("Chrome no Windows");
    expect(deviceLabel("Safari", "iPhone")).toBe("Safari no iPhone");
    expect(deviceLabel(null, "Android")).toBe("Navegador no Android");
    expect(deviceLabel(null, null)).toBe("Navegador desconhecido");
  });

  it("só o prefixo do id vai ao navegador; nada de user agent, IP ou token", () => {
    const dto = sessionFromRow(row());
    expect(dto).toEqual({
      ref: "aaaaaaaa",
      current: true,
      createdAt: "2026-10-16T10:00:00Z",
      lastActivityAt: "2026-10-16T11:00:00Z",
      mfaVerified: true,
      browser: "Chrome",
      operatingSystem: "Windows",
      device: "DESKTOP",
      label: "Chrome no Windows",
    });
    expect(JSON.stringify(dto)).not.toContain(SID);
    expect(sessionFromRow(row({ device_class: "QUALQUER", aal: "aal1" }))).toMatchObject({ device: null, mfaVerified: false });
  });

  it("MFA: só nome e data do fator verificado (o segredo nunca passa)", async () => {
    const { db } = fakeDb({ rpc: () => ({ data: [row()], error: null }) });
    const r = await getAccountSecurity(ctxWith(db));
    expect(r.mfa).toEqual({ enabled: true, factors: [{ name: "Celular", createdAt: "2026-10-01T10:00:00Z" }] });
    expect(JSON.stringify(r)).not.toContain("NUNCA");
    expect(r.sessions).toHaveLength(1);
  });
});

describe("encerrar sessões", () => {
  it("outros dispositivos: audita e encerra com scope 'others' (esta continua)", async () => {
    const { db, calls } = fakeDb();
    await signOutOtherSessions(ctxWith(db));
    expect(calls).toEqual(["rpc:record_account_security_event:OTHER_SESSIONS_REVOKED", "signOut:others"]);
  });

  it("todos: audita ANTES (o JWT ainda vale) e encerra com scope 'global'", async () => {
    const { db, calls } = fakeDb();
    await signOutAllSessions(ctxWith(db));
    expect(calls).toEqual(["rpc:record_account_security_event:ALL_SESSIONS_REVOKED", "signOut:global"]);
  });

  it("auditoria recusada (sessão não liberada): não revoga nada", async () => {
    const { db, calls } = fakeDb({ rpc: () => ({ data: null, error: { code: "42501", message: "Sem sessão liberada" } }) });
    await expect(signOutAllSessions(ctxWith(db))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(calls).toEqual(["rpc:record_account_security_event:ALL_SESSIONS_REVOKED"]);
  });

  it("falha do Auth vira mensagem amigável (sem detalhe técnico)", async () => {
    const { db } = fakeDb({ signOutError: { status: 500 } });
    await expect(signOutOtherSessions(ctxWith(db))).rejects.toMatchObject({ code: "INTERNAL", message: "Não foi possível encerrar as sessões agora. Tente novamente." });
  });

  it("limite por usuário: a 6ª ação no mesmo minuto é recusada", async () => {
    const { db, calls } = fakeDb();
    const ctx = ctxWith(db);
    for (let i = 0; i < 5; i++) await signOutOtherSessions(ctx);
    await expect(signOutOtherSessions(ctx)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(calls.filter((c) => c.startsWith("signOut"))).toHaveLength(5);
  });
});

describe("sessão encerrada (038)", () => {
  const ctx = (session_state: SessionContextRow["session_state"]): SessionContextRow => ({
    user_id: USER,
    email: "a@dgbrasil.test",
    profile: { full_name: "Ana Teste", preferred_name: null, job_title: null, active: true },
    membership: { id: "m", role: "LAWYER", status: "ACTIVE", organization: { id: "o", type: "OWNER", name: "Escritório", status: "ACTIVE", deleted: false } },
    legal_acceptances: [],
    aal: "aal2",
    session_state,
  });
  const mfa = { currentLevel: "aal2" as const, hasVerifiedFactor: true };

  it("revogada ou anterior a reset de MFA → SESSION_REVOKED → /acesso?motivo=sessao-encerrada", () => {
    for (const s of ["REVOKED", "REAUTH_REQUIRED"] as const) {
      const r = evaluateSession(ctx(s), mfa);
      expect(r.state).toBe("SESSION_REVOKED");
      expect(r.session).toBeUndefined();
      expect(destinationFor(r, "/clientes")).toBe("/acesso?motivo=sessao-encerrada");
    }
    expect(BLOCKED_MESSAGES["sessao-encerrada"].title).toBe("Sessão encerrada");
  });

  it("válida ou sem session_id (antes da 038) segue o fluxo normal", () => {
    for (const s of ["VALID", "NO_SESSION_CLAIM", undefined] as const) expect(evaluateSession(ctx(s), mfa).state).not.toBe("SESSION_REVOKED");
  });

  it("revogação vem antes de qualquer outro estado (mesmo conta inativa ou sem MFA)", () => {
    const c = { ...ctx("REVOKED"), profile: { full_name: "x", preferred_name: null, job_title: null, active: false } };
    expect(evaluateSession(c, { currentLevel: "aal1", hasVerifiedFactor: false }).state).toBe("SESSION_REVOKED");
  });
});
