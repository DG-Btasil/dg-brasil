import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TestProject } from "vitest/node";
import { LEGAL_DOCUMENTS } from "../../../src/lib/auth/legal-documents";
import { integrationEnv } from "./env";
import { totp } from "./totp";
import type { World, WorldRole } from "./world-types";

/**
 * Monta, UMA vez por execução, o cenário fictício no Supabase DEV:
 * escritório proprietário (já existe) + parceiros A e B novos, e um usuário
 * por papel — com termos aceitos e MFA (TOTP) cadastrado e verificado. Cada
 * papel recebe um access token aal2 que os arquivos de teste reutilizam
 * (sem novo login, sem reuso de código TOTP).
 */

const ROLES: { role: WorldRole; membership: string; org: "owner" | "partnerA" | "partnerB" }[] = [
  { role: "ADMIN", membership: "ADMIN", org: "owner" },
  { role: "LAWYER", membership: "LAWYER", org: "owner" },
  { role: "ASSISTANT", membership: "ASSISTANT", org: "owner" },
  { role: "PARTNER_ADMIN_A", membership: "PARTNER_ADMIN", org: "partnerA" },
  { role: "PARTNER_USER_A", membership: "PARTNER_USER", org: "partnerA" },
  { role: "PARTNER_ADMIN_B", membership: "PARTNER_ADMIN", org: "partnerB" },
  { role: "PARTNER_USER_B", membership: "PARTNER_USER", org: "partnerB" },
];

type Outcome = { data: unknown; error: { message: string; code?: string } | null };
async function ok<R extends Outcome>(p: PromiseLike<R>, what: string): Promise<NonNullable<Extract<R, { error: null }>["data"]>> {
  const { data, error } = await p;
  if (error) throw new Error(`[setup] ${what}: ${error.code ?? ""} ${error.message}`);
  if (data === null || data === undefined) throw new Error(`[setup] ${what}: sem dados`);
  return data as NonNullable<Extract<R, { error: null }>["data"]>;
}

async function verifyCode(client: SupabaseClient, factorId: string, secret: string) {
  const first = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
  if (!first.error) return;
  // Código da mesma janela de 30 s pode ser recusado (proteção contra reuso).
  await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 1_000));
  await ok(client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) }), "MFA (2ª tentativa)");
}

export default async function setup(project: TestProject) {
  const env = integrationEnv();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(env.url, env.serviceKey, options);
  const run = `i${Date.now().toString(36)}`;

  const owner = await ok(service.from("organizations").select("id").eq("type", "OWNER").is("deleted_at", null).single(), "OWNER");
  const area = await ok(service.from("legal_areas").select("id").eq("code", "BANKING").single(), "área BANKING");

  const orgs: Record<"owner" | "partnerA" | "partnerB", string> = { owner: owner.id, partnerA: "", partnerB: "" };
  for (const key of ["partnerA", "partnerB"] as const) {
    const org = await ok(
      service.from("organizations").insert({ type: "PARTNER", name: `Parceiro ${key.slice(-1)} ${run}`, status: "ACTIVE" }).select("id").single(),
      `organização ${key}`,
    );
    orgs[key] = org.id;
    await ok(
      service.from("partner_office_settings").insert({ organization_id: org.id, default_partner_percentage: 50, default_owner_percentage: 50 }),
      `percentual ${key}`,
    );
  }

  const users = {} as World["users"];
  for (const r of ROLES) {
    const email = `${run}.${r.role.toLowerCase()}@dgbrasil.test`;
    const password = `${randomBytes(18).toString("base64url")}Aa1`;
    const created = await ok(
      service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Teste ${r.role}` } }),
      `usuário ${r.role}`,
    );
    const id = created.user.id;
    await ok(service.from("organization_memberships").insert({ organization_id: orgs[r.org], user_id: id, role: r.membership }), `vínculo ${r.role}`);
    await ok(
      service.from("user_legal_acceptances").insert(LEGAL_DOCUMENTS.map((d) => ({ user_id: id, document_type: d.type, document_version: d.version }))),
      `termos ${r.role}`,
    );

    const client = createClient(env.url, env.anonKey, options);
    await ok(client.auth.signInWithPassword({ email, password }), `login ${r.role}`);
    const factor = await ok(client.auth.mfa.enroll({ factorType: "totp", friendlyName: `dg-${run}-${r.role}` }), `MFA ${r.role}`);
    await verifyCode(client, factor.id, factor.totp.secret);
    const session = await ok(client.auth.getSession(), `sessão ${r.role}`);
    if (!session.session) throw new Error(`[setup] sem sessão para ${r.role}`);
    users[r.role] = { id, email, organizationId: orgs[r.org], accessToken: session.session.access_token };
  }

  const world: World = { run, owner: orgs.owner, partnerA: orgs.partnerA, partnerB: orgs.partnerB, bankingAreaId: area.id, users };
  project.provide("world", world);
}
