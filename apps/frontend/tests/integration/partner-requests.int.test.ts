import { describe, expect, it } from "vitest";
import * as requests from "@/server/domain/partner-requests/service";
import { OWNER_TEAM_LABEL } from "@/server/domain/partner-requests/mappers";
import { addPartnerRequestMessageSchema, createPartnerRequestSchema, listPartnerRequestsSchema } from "@/server/domain/partner-requests/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Solicitações a parceiro no Supabase DEV real: o parceiro só vê e responde as
 * do próprio escritório (IDOR A × B), o DTO do parceiro não tem dado interno e
 * o encerramento é da equipe interna.
 */

/** Caso do parceiro A pelo caminho real (partner_submit_case). */
async function partnerACase(): Promise<string> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Solicitação" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso solicitação", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

const newRequest = (legalCaseId: string, title = "Enviar procuração assinada") =>
  createPartnerRequestSchema.parse({ legalCaseId, type: "DOCUMENT_REQUEST", title, description: "Assinada pelo cliente", dueDate: "2026-12-01" });

const message = (requestId: string, text: string, reopen = false) => addPartnerRequestMessageSchema.parse({ requestId, message: text, reopen });

describe("solicitações — equipe interna cria, parceiro do caso recebe", () => {
  it("destino é o parceiro do caso (nunca do navegador); A lista e abre; B não vê nem responde (IDOR)", async () => {
    const caseId = await partnerACase();
    const { id } = await requests.createPartnerRequest(await ctxFor("ASSISTANT"), newRequest(caseId));
    const { data: stored } = await serviceDb().from("partner_requests").select("partner_organization_id, created_by, type, status").eq("id", id).single();
    expect(stored).toMatchObject({ partner_organization_id: world.partnerA, created_by: world.users.ASSISTANT.id, type: "DOCUMENT", status: "OPEN" });

    const a = await ctxFor("PARTNER_USER_A");
    const listA = await requests.listPartnerRequests(a, listPartnerRequestsSchema.parse({ legalCaseId: caseId }));
    expect(listA.items.map((r) => r.id)).toEqual([id]);
    expect(listA.items[0]).not.toHaveProperty("createdById");
    expect(listA.items[0]).not.toHaveProperty("partnerOrganizationId");
    expect(listA.items[0].type).toBe("DOCUMENT_REQUEST");

    const b = await ctxFor("PARTNER_USER_B");
    const listB = await requests.listPartnerRequests(b, listPartnerRequestsSchema.parse({ pageSize: 50, legalCaseId: caseId }));
    expect(listB.items).toHaveLength(0);
    await expectDomainError(requests.getPartnerRequest(b, id), "NOT_FOUND");
    await expectDomainError(requests.addPartnerRequestMessage(b, message(id, "tentativa de B")), "NOT_FOUND");

    // Barreira do banco: B tentando direto pela API.
    const direct = await b.db.from("partner_request_messages").insert({ partner_request_id: id, author_id: world.users.PARTNER_USER_B.id, body: "direto" });
    expect(direct.error).not.toBeNull();
    const update = await b.db.from("partner_requests").update({ status: "ANSWERED" }, { count: "exact" }).eq("id", id);
    expect(update.count ?? 0).toBe(0);
    const { data: after } = await serviceDb().from("partner_requests").select("status").eq("id", id).single();
    expect(after?.status).toBe("OPEN");
    const { count } = await serviceDb().from("partner_request_messages").select("id", { count: "exact", head: true }).eq("partner_request_id", id);
    expect(count).toBe(0);
  });

  it("parceiro A responde (OPEN → ANSWERED); interno pede nova resposta; DTO do parceiro sem dado interno", async () => {
    const caseId = await partnerACase();
    const lawyer = await ctxFor("LAWYER");
    const { id } = await requests.createPartnerRequest(lawyer, newRequest(caseId, "Informar banco do contrato"));
    await requests.addPartnerRequestMessage(lawyer, message(id, "Qual o banco do contrato?"));

    const a = await ctxFor("PARTNER_USER_A");
    expect(await requests.addPartnerRequestMessage(a, message(id, "Banco X."))).toMatchObject({ status: "ANSWERED" });

    const internal = await requests.getPartnerRequest(lawyer, id);
    if (internal.surface !== "INTERNAL") throw new Error("superfície");
    expect(internal.request.status).toBe("ANSWERED");
    expect(internal.request.answeredAt).toBeTruthy();
    expect(internal.request.messages.map((m) => m.side)).toEqual(["OWNER", "PARTNER"]);
    expect(internal.request.messages[0].author.id).toBe(world.users.LAWYER.id);
    expect(internal.request.messages[1].author.id).toBe(world.users.PARTNER_USER_A.id);

    const partner = await requests.getPartnerRequest(a, id);
    expect(partner.surface).toBe("PARTNER");
    const json = JSON.stringify(partner);
    expect(json).not.toContain(world.users.LAWYER.id);
    expect(json).not.toContain("Teste LAWYER");
    expect(partner.request).not.toHaveProperty("createdById");
    expect(partner.request.messages[0]).toMatchObject({ side: "OWNER", authorName: OWNER_TEAM_LABEL });
    expect(partner.request.messages[0]).not.toHaveProperty("author");

    // Interno pede complemento: volta a OPEN; o parceiro responde de novo.
    expect(await requests.addPartnerRequestMessage(lawyer, message(id, "Envie também o número do contrato.", true))).toMatchObject({ status: "OPEN" });
    expect(await requests.addPartnerRequestMessage(a, message(id, "Contrato 123."))).toMatchObject({ status: "ANSWERED" });
  });

  it("parceiro só responde: não cria, não encerra, não altera a solicitação pela API", async () => {
    const caseId = await partnerACase();
    const pa = await ctxFor("PARTNER_ADMIN_A");
    await expectDomainError(requests.createPartnerRequest(pa, newRequest(caseId)), "FORBIDDEN");
    const { id } = await requests.createPartnerRequest(await ctxFor("LAWYER"), newRequest(caseId));
    await expectDomainError(requests.closePartnerRequest(pa, { id, resolution: "RESOLVED" }), "FORBIDDEN");
    // Trigger private.partner_requests_guard: parceiro não muda título (nem nada além da resposta).
    const direct = await pa.db.from("partner_requests").update({ title: "alterado pelo parceiro" }).eq("id", id);
    expect(direct.error).not.toBeNull();
    const { data } = await serviceDb().from("partner_requests").select("title").eq("id", id).single();
    expect(data?.title).toBe("Enviar procuração assinada");
  });

  it("encerrada não recebe mensagem e não se encerra duas vezes", async () => {
    const caseId = await partnerACase();
    const assistant = await ctxFor("ASSISTANT");
    const { id } = await requests.createPartnerRequest(assistant, newRequest(caseId));
    await requests.closePartnerRequest(assistant, { id, resolution: "RESOLVED" });
    const { data } = await serviceDb().from("partner_requests").select("status, resolved_at").eq("id", id).single();
    expect(data?.status).toBe("RESOLVED");
    expect(data?.resolved_at).toBeTruthy();
    await expectDomainError(requests.closePartnerRequest(assistant, { id, resolution: "CANCELLED" }), "INVALID_STATE");
    await expectDomainError(requests.addPartnerRequestMessage(await ctxFor("PARTNER_USER_A"), message(id, "tarde demais")), "INVALID_STATE");
    await expectDomainError(requests.closePartnerRequest(assistant, { id: "00000000-0000-4000-8000-000000000000", resolution: "CANCELLED" }), "NOT_FOUND");
  });
});
