import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, inject } from "vitest";
import { evaluateSession } from "@/lib/auth/evaluate";
import type { SessionContextRow } from "@/lib/auth/types";
import { createServiceContext, type ServiceContext } from "@/server/core/context";
import { DomainError, type DomainErrorCode } from "@/server/core/errors";
import { integrationEnv } from "./env";
import type { World, WorldRole } from "./world-types";

export type { WorldRole } from "./world-types";

const env = integrationEnv();
export const world: World = inject("world");

/** Sequência única por execução: CPFs/CNPJs fictícios (prefixo 999) sem colisão. */
let seq = Math.floor(Math.random() * 1e5);
export function fakeCpf(): string {
  seq = (seq + 1) % 1e8;
  return `999${String(seq).padStart(8, "0")}`;
}
/**
 * CNJ fictício VÁLIDO (dígito verificador correto): NNNNNNN-DD.2026.8.26.OOOO.
 * CNJ é único no banco inteiro e o DEV acumula rodadas: número e origem variam.
 */
export function fakeCnj(): string {
  seq = (seq + 1) % 1e7;
  const n = String(seq).padStart(7, "0");
  const rest = `2026826${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;
  const dd = 98n - (BigInt(`${n}${rest}00`) % 97n);
  return `${n}${String(dd).padStart(2, "0")}${rest}`;
}
export function fakeCnpj(): string {
  seq = (seq + 1) % 1e8;
  return `999${String(seq).padStart(11, "0")}`;
}

/** Client com o JWT aal2 do papel (RLS real). */
export function dbFor(role: WorldRole, requestId = randomUUID()): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${world.users[role].accessToken}`, "x-dg-request-id": requestId } },
  });
}

/** Service role: SÓ para preparar cenário e conferir resultado nos testes. */
export function serviceDb(): SupabaseClient {
  return createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

const sessions = new Map<WorldRole, ServiceContext["session"]>();

/** Contexto de service do papel, com a sessão montada como o servidor monta (banco + evaluateSession). */
export async function ctxFor(role: WorldRole): Promise<ServiceContext> {
  const requestId = randomUUID();
  const db = dbFor(role, requestId);
  let session = sessions.get(role);
  if (!session) {
    const { data, error } = await db.rpc("get_my_session_context");
    if (error) throw new Error(`contexto ${role}: ${error.message}`);
    const result = evaluateSession(data as SessionContextRow, { currentLevel: "aal2", hasVerifiedFactor: true });
    if (result.state !== "READY" || !result.session) throw new Error(`sessão ${role} não está READY: ${result.state}`);
    session = result.session;
    sessions.set(role, session);
  }
  return createServiceContext({ db, session, requestId, action: `test.${role}` });
}

/** A promessa falha com DomainError do código esperado. */
export async function expectDomainError(promise: Promise<unknown>, code: DomainErrorCode, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, `esperava DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  if (message) expect((error as DomainError).publicMessage).toMatch(message);
}
