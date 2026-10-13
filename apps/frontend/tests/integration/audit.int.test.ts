import { describe, expect, it } from "vitest";
import * as audit from "@/server/domain/audit/service";
import { listAuditEventsSchema, listPersonalDataAccessSchema } from "@/server/domain/audit/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as orgs from "@/server/domain/organizations/service";
import { createPartnerSchema } from "@/server/domain/organizations/schemas";
import { ctxFor, expectDomainError, fakeCnpj, fakeCpf, world } from "./support/world";

/** Auditoria no Supabase DEV real: leitura só ADMIN, DTO sanitizado, nenhuma escrita possível. */

async function createAuditedPartner(): Promise<string> {
  const { id } = await orgs.createPartner(
    await ctxFor("ADMIN"),
    createPartnerSchema.parse({ name: `Parceiro Auditoria ${world.run} ${Date.now()}`, cnpj: fakeCnpj(), partnershipPercentage: 45, ownerPercentage: 55 }),
  );
  return id;
}

describe("auditoria — leitura ADMIN", () => {
  it("ADMIN lê os eventos da entidade, com ator e metadata da whitelist (sem IP/user agent)", async () => {
    const id = await createAuditedPartner();
    const page = await audit.listAuditEvents(await ctxFor("ADMIN"), listAuditEventsSchema.parse({ entityType: "organizations", entityId: id, pageSize: 50 }));
    const actions = page.items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["ORGANIZATION_CREATED", "PARTNER_SETTINGS_CREATED"]));

    const settings = page.items.find((e) => e.action === "PARTNER_SETTINGS_CREATED");
    expect(settings).toMatchObject({ actorType: "USER", actorUserId: world.users.ADMIN.id, actorName: "Teste ADMIN" });
    expect(Number(settings?.metadata.partner_percentage)).toBe(45);
    for (const event of page.items) {
      expect(event).not.toHaveProperty("ipAddress");
      expect(event).not.toHaveProperty("userAgent");
      expect(event).not.toHaveProperty("ip_address");
    }
  });

  it("filtros por ação, ator e período", async () => {
    const id = await createAuditedPartner();
    const admin = await ctxFor("ADMIN");
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const byAction = await audit.listAuditEvents(admin, listAuditEventsSchema.parse({ action: "organization_created", actorUserId: world.users.ADMIN.id, from: since, pageSize: 50 }));
    expect(byAction.items.map((e) => e.entityId)).toContain(id);
    expect(byAction.items.every((e) => e.action === "ORGANIZATION_CREATED")).toBe(true);

    const past = await audit.listAuditEvents(admin, listAuditEventsSchema.parse({ entityId: id, to: "2020-01-01T00:00:00Z" }));
    expect(past.total).toBe(0);
  });

  it("LAWYER, ASSISTANT e parceiro: FORBIDDEN", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN_A", "PARTNER_USER_B"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(audit.listAuditEvents(ctx, listAuditEventsSchema.parse({})), "FORBIDDEN");
      await expectDomainError(audit.listPersonalDataAccessEvents(ctx, listPersonalDataAccessSchema.parse({})), "FORBIDDEN");
    }
    // Segunda barreira: mesmo pelo client direto, a RLS não devolve nada a quem não é ADMIN.
    const { data } = await (await ctxFor("LAWYER")).db.from("audit_events").select("id").limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it("acessos a dado pessoal (LGPD): ADMIN lê quem abriu a ficha", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { id: clientId } = await clients.createClient(
      lawyer,
      createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Titular Auditoria", originOfficeId: world.owner }),
    );
    await clients.getClient(lawyer, clientId);
    const page = await audit.listPersonalDataAccessEvents(await ctxFor("ADMIN"), listPersonalDataAccessSchema.parse({ clientId }));
    expect(page.items[0]).toMatchObject({ clientId, action: "VIEW_DETAIL", resourceType: "CLIENT", actorUserId: world.users.LAWYER.id });
  });
});

describe("auditoria — sem escrita", () => {
  it("o módulo não tem operação de escrita", () => {
    expect(Object.keys(audit).sort()).toEqual(["listAuditEvents", "listPersonalDataAccessEvents"]);
  });

  it("nem o ADMIN grava, altera ou apaga evento pelo client do usuário", async () => {
    const id = await createAuditedPartner();
    const { db } = await ctxFor("ADMIN");
    const { data: row } = await db.from("audit_events").select("id").eq("entity_id", id).limit(1).single();
    const eventId = (row as { id: string }).id;

    const insert = await db.from("audit_events").insert({ actor_type: "SYSTEM", action: "FORGED_EVENT", entity_type: "organizations", entity_id: id });
    expect(insert.error).not.toBeNull();

    const update = await db.from("audit_events").update({ action: "TAMPERED" }, { count: "exact" }).eq("id", eventId);
    expect(update.error !== null || (update.count ?? 0) === 0).toBe(true);

    const remove = await db.from("audit_events").delete({ count: "exact" }).eq("id", eventId);
    expect(remove.error !== null || (remove.count ?? 0) === 0).toBe(true);

    const { data: still } = await db.from("audit_events").select("action").eq("id", eventId).single();
    expect((still as { action: string }).action).not.toBe("TAMPERED");
  });
});
