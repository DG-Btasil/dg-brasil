import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateSession } from "@/lib/auth/evaluate";
import { LEGAL_DOCUMENTS } from "@/lib/auth/legal-documents";
import type { SessionContextRow } from "@/lib/auth/types";
import { createServiceContext, type ServiceContext } from "@/server/core/context";
import * as security from "@/server/domain/account/security";
import { integrationEnv } from "./support/env";
import { totp } from "./support/totp";
import { dbFor, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3.2 — sessões e dispositivos no Supabase DEV real (migration 038).
 *
 * Usa uma conta PRÓPRIA deste arquivo (ASSISTANT do escritório), com várias
 * sessões reais (senha + TOTP → aal2), cada uma com um "navegador" diferente
 * (cabeçalho User-Agent). Nunca encerra sessões dos usuários compartilhados
 * do cenário (o resto da suíte depende deles).
 */

const env = integrationEnv();
const svc = serviceDb();
const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0",
};

const account = { id: "", email: `${world.run}.sessoes@dgbrasil.test`, password: `${randomBytes(18).toString("base64url")}Aa1`, secret: "", factorId: "", membershipId: "" };

function newClient(userAgent: string): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { "User-Agent": userAgent } } });
}

/** Client só com um access token (o que um navegador "esquecido" ainda tem na mão). */
function withToken(accessToken: string): SupabaseClient {
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

async function verify(client: SupabaseClient) {
  const first = await client.auth.mfa.challengeAndVerify({ factorId: account.factorId, code: totp(account.secret) });
  if (!first.error) return;
  // O Auth recusa o mesmo código duas vezes: espera a próxima janela de 30 s.
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1_000));
  const second = await client.auth.mfa.challengeAndVerify({ factorId: account.factorId, code: totp(account.secret) });
  if (second.error) throw new Error(`MFA: ${second.error.message}`);
}

/** Login completo (senha + TOTP) num "navegador": devolve o client e o access token aal2. */
async function signIn(userAgent: string): Promise<{ client: SupabaseClient; token: string }> {
  const client = newClient(userAgent);
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`login: ${error.message}`);
  await verify(client);
  const { data } = await client.auth.getSession();
  return { client, token: data.session!.access_token };
}

async function contextOf(db: SupabaseClient): Promise<SessionContextRow> {
  const { data, error } = await db.rpc("get_my_session_context");
  if (error) throw new Error(`contexto: ${error.message}`);
  return data as SessionContextRow;
}

async function ctxOf(db: SupabaseClient): Promise<ServiceContext> {
  const result = evaluateSession(await contextOf(db), { currentLevel: "aal2", hasVerifiedFactor: true });
  if (result.state !== "READY" || !result.session) throw new Error(`sessão não está READY: ${result.state}`);
  return createServiceContext({ db, session: result.session, requestId: randomUUID(), action: "test.account" });
}

const visibleClients = async (db: SupabaseClient) => (await db.from("clients").select("id").limit(5)).data ?? [];
const auditOf = async (action: string) =>
  (await svc.from("audit_events").select("id, actor_user_id, metadata").eq("entity_id", account.id).eq("action", action)).data ?? [];
const securityNotices = async () => (await svc.from("notifications").select("title, event_key").eq("user_id", account.id).eq("type", "SECURITY_NOTICE")).data ?? [];

let a: { client: SupabaseClient; token: string };
let b: { client: SupabaseClient; token: string };

beforeAll(async () => {
  const created = await svc.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true, user_metadata: { full_name: "Teste Sessões" } });
  if (created.error) throw new Error(created.error.message);
  account.id = created.data.user.id;
  const m = await svc.from("organization_memberships").insert({ organization_id: world.owner, user_id: account.id, role: "ASSISTANT" }).select("id").single();
  if (m.error) throw new Error(m.error.message);
  account.membershipId = m.data.id;
  await svc.from("user_legal_acceptances").insert(LEGAL_DOCUMENTS.map((d) => ({ user_id: account.id, document_type: d.type, document_version: d.version })));

  // 1º login: cadastra o autenticador (vira a sessão A, "Chrome no Windows").
  const client = newClient(UA.chromeWindows);
  await client.auth.signInWithPassword({ email: account.email, password: account.password });
  const factor = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `dg-${world.run}-sessoes` });
  if (factor.error) throw new Error(factor.error.message);
  account.factorId = factor.data.id;
  account.secret = factor.data.totp.secret;
  await verify(client);
  a = { client, token: (await client.auth.getSession()).data.session!.access_token };
  b = await signIn(UA.safariIphone);
}, 300_000);

afterAll(async () => {
  // A conta de teste não fica com acesso: vínculo removido (sessões já encerradas no último teste).
  if (account.membershipId) await svc.from("organization_memberships").update({ status: "REMOVED" }).eq("id", account.membershipId);
});

describe("sessões da própria conta (038)", () => {
  it("lista: só as minhas; a atual marcada; navegador e sistema amigáveis; sem user agent, IP ou id completo", async () => {
    const r = await security.getAccountSecurity(await ctxOf(a.client));
    expect(r.sessions.length).toBeGreaterThanOrEqual(2);
    expect(r.sessions.filter((s) => s.current)).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ current: true, label: "Chrome no Windows", device: "DESKTOP", mfaVerified: true });
    expect(r.sessions.some((s) => !s.current && s.label === "Safari no iPhone" && s.device === "MOBILE")).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/Mozilla|AppleWebKit|\d+\.\d+\.\d+\.\d+/);
    expect(r.sessions.every((s) => s.ref.length === 8)).toBe(true);
    expect(r.mfa.enabled).toBe(true);
    expect(json).not.toContain(account.secret);
  });

  it("privacidade: outro usuário não vê estas sessões (e vice-versa)", async () => {
    const mine = (await a.client.rpc("get_my_sessions")).data as { session_id: string }[];
    const lawyer = (await dbFor("LAWYER").rpc("get_my_sessions")).data as { session_id: string }[];
    expect(lawyer.length).toBeGreaterThan(0);
    expect(lawyer.some((s) => mine.some((x) => x.session_id === s.session_id))).toBe(false);
  });

  it("auth.sessions não é exposta pela Data API", async () => {
    const { data, error } = await a.client.schema("auth" as "public").from("sessions").select("*");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it("suspensão: vínculo suspenso perde o acesso na próxima requisição, mesmo com o JWT válido", async () => {
    await svc.from("organization_memberships").update({ status: "SUSPENDED" }).eq("id", account.membershipId);
    try {
      expect(evaluateSession(await contextOf(a.client), { currentLevel: "aal2", hasVerifiedFactor: true }).state).toBe("MEMBERSHIP_INACTIVE");
      expect(await visibleClients(a.client)).toHaveLength(0);
      expect((await a.client.rpc("get_my_sessions")).error?.message).toMatch(/Sem sessão liberada/);
    } finally {
      await svc.from("organization_memberships").update({ status: "ACTIVE" }).eq("id", account.membershipId);
    }
    expect((await visibleClients(a.client)).length).toBeGreaterThan(0);
  });

  it("sair deste dispositivo (scope local): só esta sessão cai; o JWT dela, ainda não expirado, perde o banco na hora", async () => {
    const c = await signIn(UA.firefoxMac);
    expect((await visibleClients(c.client)).length).toBeGreaterThan(0);
    expect((await c.client.rpc("record_account_security_event", { p_action: "SESSION_CURRENT_REVOKED" })).error).toBeNull();
    expect((await c.client.auth.signOut({ scope: "local" })).error).toBeNull();
    const stale = withToken(c.token);
    expect(await visibleClients(stale)).toHaveLength(0);
    expect((await contextOf(stale)).session_state).toBe("REVOKED");
    // A e B continuam.
    expect((await contextOf(a.client)).session_state).toBe("VALID");
    expect((await contextOf(b.client)).session_state).toBe("VALID");
    expect(await auditOf("SESSION_CURRENT_REVOKED")).toHaveLength(1);
  });

  it("sair dos outros dispositivos: B cai (refresh e banco); A continua; auditado e avisado", async () => {
    await security.signOutOtherSessions(await ctxOf(a.client));
    const staleB = withToken(b.token);
    expect(await visibleClients(staleB)).toHaveLength(0);
    expect((await contextOf(staleB)).session_state).toBe("REVOKED");
    expect((await b.client.auth.refreshSession()).error).not.toBeNull();
    expect((await contextOf(a.client)).session_state).toBe("VALID");
    expect((await visibleClients(a.client)).length).toBeGreaterThan(0);
    const list = (await security.getAccountSecurity(await ctxOf(a.client))).sessions;
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
    const ev = await auditOf("OTHER_SESSIONS_REVOKED");
    expect(ev).toHaveLength(1);
    expect(ev[0].actor_user_id).toBe(account.id);
    expect(JSON.stringify(ev)).not.toMatch(/eyJ|refresh|secret|password/i);
    expect((await securityNotices()).map((n) => n.title)).toContain("Outras sessões encerradas");
  });

  it("troca de senha: auditoria + aviso; as outras sessões caem; esta continua", async () => {
    b = await signIn(UA.safariIphone);
    account.password = `${randomBytes(18).toString("base64url")}Bb2`;
    expect((await a.client.auth.updateUser({ password: account.password })).error).toBeNull();
    expect((await a.client.rpc("record_account_security_event", { p_action: "PASSWORD_CHANGED" })).error).toBeNull();
    expect((await a.client.auth.signOut({ scope: "others" })).error).toBeNull();
    expect((await contextOf(withToken(b.token))).session_state).toBe("REVOKED");
    expect((await contextOf(a.client)).session_state).toBe("VALID");
    expect((await securityNotices()).map((n) => n.title)).toContain("Sua senha foi alterada");
  });

  it("reset de MFA pelo administrador: a sessão aberta antes perde o acesso (precisa entrar de novo)", async () => {
    const c = await signIn(UA.firefoxMac);
    expect((await contextOf(c.client)).session_state).toBe("VALID");
    // O que resetUserMfa faz (team-actions): auditoria + remoção do fator, com o ADMIN como autor.
    await svc.rpc("record_auth_event", { p_action: "MFA_RESET_COMPLETED", p_target_user: account.id, p_metadata: {}, p_actor: world.users.ADMIN.id });
    const del = await svc.auth.admin.mfa.deleteFactor({ id: account.factorId, userId: account.id });
    expect(del.error).toBeNull();
    for (const s of [c, a]) {
      const ctx = await contextOf(withToken(s.token));
      // 038 marca REAUTH_REQUIRED; se o próprio Auth já tiver apagado a sessão ao remover o fator, REVOKED.
      expect(["REAUTH_REQUIRED", "REVOKED"]).toContain(ctx.session_state);
      expect(evaluateSession(ctx, { currentLevel: "aal2", hasVerifiedFactor: false }).state).toBe("SESSION_REVOKED");
      expect(await visibleClients(withToken(s.token))).toHaveLength(0);
    }
    // Sessão nova (depois do reset): válida, e o próximo passo é cadastrar o MFA de novo.
    const fresh = newClient(UA.chromeWindows);
    await fresh.auth.signInWithPassword({ email: account.email, password: account.password });
    const ctx = await contextOf(fresh);
    expect(ctx.session_state).toBe("VALID");
    expect(evaluateSession(ctx, { currentLevel: "aal1", hasVerifiedFactor: false }).state).toBe("MFA_ENROLL");
    // Novo autenticador para o último teste.
    const factor = await fresh.auth.mfa.enroll({ factorType: "totp", friendlyName: `dg-${world.run}-sessoes-2` });
    account.factorId = factor.data!.id;
    account.secret = factor.data!.totp.secret;
    await verify(fresh);
    a = { client: fresh, token: (await fresh.auth.getSession()).data.session!.access_token };
  }, 180_000);

  it("sair de todos os dispositivos: todas caem, inclusive esta; auditado antes", async () => {
    b = await signIn(UA.safariIphone);
    await security.signOutAllSessions(await ctxOf(a.client));
    for (const s of [a, b]) {
      expect((await contextOf(withToken(s.token))).session_state).toBe("REVOKED");
      expect(await visibleClients(withToken(s.token))).toHaveLength(0);
    }
    expect((await b.client.auth.refreshSession()).error).not.toBeNull();
    expect(await auditOf("ALL_SESSIONS_REVOKED")).toHaveLength(1);
    expect((await securityNotices()).map((n) => n.title)).toContain("Todas as sessões encerradas");
  }, 120_000);

  it("ações fora da lista e sem MFA são recusadas pelo banco", async () => {
    const lawyer = dbFor("LAWYER");
    expect((await lawyer.rpc("record_account_security_event", { p_action: "MFA_RESET_COMPLETED" })).error?.message).toMatch(/não permitido/);
    const aal1 = newClient(UA.chromeWindows);
    await aal1.auth.signInWithPassword({ email: account.email, password: account.password });
    expect((await aal1.rpc("record_account_security_event", { p_action: "PASSWORD_CHANGED" })).error?.message).toMatch(/Sem sessão liberada/);
    expect((await aal1.rpc("get_my_sessions")).error?.message).toMatch(/Sem sessão liberada/);
    await aal1.auth.signOut({ scope: "local" });
  });
});
