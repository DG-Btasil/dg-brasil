import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as notifications from "@/server/domain/notifications/service";
import * as preferences from "@/server/domain/notifications/preferences";
import { listNotificationsSchema } from "@/server/domain/notifications/schemas";
import * as requests from "@/server/domain/partner-requests/service";
import { addPartnerRequestMessageSchema, createPartnerRequestSchema } from "@/server/domain/partner-requests/schemas";
import { ctxFor, fakeCpf, serviceDb, world, type WorldRole } from "./support/world";

/**
 * Etapa 4.3.1 — produtor de notificações (migration 037) no Supabase DEV real:
 * operações de verdade geram os avisos certos, para as pessoas certas, uma
 * vez só; outro escritório não recebe; preferência desligada é respeitada.
 */

const svc = serviceDb();

async function inbox(role: WorldRole, type: string, caseId?: string) {
  const page = await notifications.listNotifications(await ctxFor(role), listNotificationsSchema.parse({ pageSize: 50 }));
  return page.items.filter((n) => n.type === type && (!caseId || n.legalCaseId === caseId));
}

async function partnerCase(title: string): Promise<string> {
  const { data, error } = await (await ctxFor("PARTNER_USER_A")).db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Avisos 4.3.1" },
    p_case: { legal_area_id: world.bankingAreaId, title, origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

describe("avisos produzidos por operações reais (037)", () => {
  it("aceite com advogado: o advogado e o escritório parceiro A são avisados — uma vez; o parceiro B, não", async () => {
    const caseId = await partnerCase(`Caso avisos 4.3.1 ${world.run}`);
    const admin = await ctxFor("ADMIN");
    await admin.db.from("legal_cases").update({ assigned_lawyer_id: world.users.LAWYER.id }).eq("id", caseId);
    await admin.db.from("legal_cases").update({ status: "ACCEPTED", accepted_at: new Date().toISOString() }).eq("id", caseId);
    expect(await inbox("LAWYER", "CASE_ASSIGNED", caseId)).toHaveLength(1);
    expect(await inbox("PARTNER_ADMIN_A", "CASE_ACCEPTED", caseId)).toHaveLength(1);
    expect(await inbox("PARTNER_USER_A", "CASE_ACCEPTED", caseId)).toHaveLength(1);
    expect(await inbox("PARTNER_ADMIN_B", "CASE_ACCEPTED", caseId)).toHaveLength(0);
    // Mesma mudança de novo (nova tentativa): nada duplica.
    await admin.db.from("legal_cases").update({ assigned_lawyer_id: world.users.LAWYER.id }).eq("id", caseId);
    expect(await inbox("LAWYER", "CASE_ASSIGNED", caseId)).toHaveLength(1);
  });

  it("solicitação aberta pelo escritório → parceiro A; resposta do parceiro → advogado do caso", async () => {
    const caseId = await partnerCase(`Caso solicitação 4.3.1 ${world.run}`);
    const admin = await ctxFor("ADMIN");
    await admin.db.from("legal_cases").update({ assigned_lawyer_id: world.users.LAWYER.id }).eq("id", caseId);
    const req = await requests.createPartnerRequest(await ctxFor("LAWYER"), createPartnerRequestSchema.parse({ legalCaseId: caseId, type: "DOCUMENT_REQUEST", title: "Enviar extrato (teste)" }));
    expect((await inbox("PARTNER_USER_A", "PARTNER_REQUEST_CREATED", caseId)).length).toBe(1);
    await requests.addPartnerRequestMessage(await ctxFor("PARTNER_USER_A"), addPartnerRequestMessageSchema.parse({ requestId: req.id, message: "Enviado (teste)" }));
    expect((await inbox("LAWYER", "PARTNER_REQUEST_REPLY", caseId)).length).toBe(1);
  });

  it("preferência desligada não gera aviso; segurança fica sempre ligada", async () => {
    const lawyer = await ctxFor("LAWYER");
    const saved = await preferences.saveNotificationPreferences(lawyer, {
      categories: [
        { category: "DEADLINES", inApp: false, email: true },
        { category: "SECURITY", inApp: false, email: false },
      ],
      digest: "WEEKLY",
    });
    expect(saved.categories.find((c) => c.category === "DEADLINES")).toMatchObject({ inApp: false, email: true });
    expect(saved.categories.find((c) => c.category === "SECURITY")).toMatchObject({ inApp: true });
    expect(saved.digest).toBe("WEEKLY");

    const caseId = await partnerCase(`Caso prazo 4.3.1 ${world.run}`);
    const title = `Prazo sem aviso ${randomUUID().slice(0, 8)}`;
    const d = await (await ctxFor("ADMIN")).db.from("deadlines").insert({ legal_case_id: caseId, title, due_at: new Date(Date.now() + 20 * 86_400_000).toISOString(), responsible_user_id: world.users.LAWYER.id });
    expect(d.error).toBeNull();
    expect((await inbox("LAWYER", "DEADLINE_CREATED")).some((n) => n.title.includes(title))).toBe(false);

    await preferences.saveNotificationPreferences(lawyer, { categories: [{ category: "DEADLINES", inApp: true, email: false }], digest: "NONE" });
  });

  it("ninguém grava aviso pela API (nem ADMIN)", async () => {
    const { error } = await (await ctxFor("ADMIN")).db.from("notifications").insert({ user_id: world.users.LAWYER.id, type: "CASE_UPDATE", title: "forjada" });
    expect(error).not.toBeNull();
    const { count } = await svc.from("notifications").select("id", { count: "exact", head: true }).eq("title", "forjada");
    expect(count).toBe(0);
  });
});
