import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as cases from "@/server/domain/cases/service";
import { getPartnerCaseTimeline } from "@/server/domain/cases/partner-timeline";
import { createCaseSchema, partnerCaseTimelineSchema, rejectCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { listClientsSchema } from "@/server/domain/clients/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3.1 — Portal do Parceiro (migration 036) no Supabase DEV real:
 * histórico do caso montado pelo banco (sem auditoria crua, sem conteúdo
 * interno) e contagens por cliente SÓ no escopo do escritório. O cliente é
 * compartilhado entre o parceiro A e um caso INTERNO, para provar que a
 * contagem não vaza o total do cliente.
 */

const svc = serviceDb();
let caseA = "";
let clientId = "";
const PUBLIC_REASON = "Documentação insuficiente (motivo público 4.3.1)";
const INTERNAL_REASON = "MOTIVO-INTERNO-431";

beforeAll(async () => {
  const pa = await ctxFor("PARTNER_ADMIN_A");
  const { data, error } = await pa.db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Portal 4.3.1" },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso portal 4.3.1 ${world.run}`, origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  caseA = (data as { legal_case_id: string }).legal_case_id;
  clientId = (await svc.from("legal_cases").select("client_id").eq("id", caseA).single()).data!.client_id;
  // Dois casos INTERNOS do mesmo cliente: o parceiro A nunca pode "vê-los" pela contagem.
  const lawyer = await ctxFor("LAWYER");
  for (const title of [`Interno 1 ${world.run}`, `Interno 2 ${world.run}`]) {
    await cases.createCase(lawyer, createCaseSchema.parse({ idempotencyKey: randomUUID(), clientId, title, area: "BANKING", originOrganizationId: world.owner, submit: false }));
  }
});

describe("histórico do caso no portal (036)", () => {
  it("parceiro A vê cadastro e recusa com o motivo PÚBLICO; nada interno; paginado", async () => {
    await cases.rejectCase(await ctxFor("ADMIN"), rejectCaseSchema.parse({ id: caseA, publicReason: PUBLIC_REASON, internalNote: INTERNAL_REASON }));
    const page = await getPartnerCaseTimeline(await ctxFor("PARTNER_ADMIN_A"), partnerCaseTimelineSchema.parse({ legalCaseId: caseA }));
    const titles = page.items.map((i) => i.title);
    expect(titles).toContain("Caso cadastrado");
    expect(page.items.find((i) => i.title === "Caso não aceito")?.description).toBe(PUBLIC_REASON);
    expect(JSON.stringify(page.items)).not.toMatch(/MOTIVO-INTERNO-431|request_id|ip_address/);
    const small = await getPartnerCaseTimeline(await ctxFor("PARTNER_USER_A"), partnerCaseTimelineSchema.parse({ legalCaseId: caseA, pageSize: 1 }));
    expect(small.items).toHaveLength(1);
    expect(small.total).toBe(page.total);
  });

  it("parceiro B e equipe interna não usam o histórico do portal", async () => {
    await expectDomainError(getPartnerCaseTimeline(await ctxFor("PARTNER_ADMIN_B"), partnerCaseTimelineSchema.parse({ legalCaseId: caseA })), "NOT_FOUND");
    await expectDomainError(getPartnerCaseTimeline(await ctxFor("ADMIN"), partnerCaseTimelineSchema.parse({ legalCaseId: caseA })), "FORBIDDEN");
  });
});

describe("contagens por cliente no portal (036)", () => {
  it("só o escopo do escritório: o cliente tem 3 casos no total, o parceiro A vê 1", async () => {
    const { count: all } = await svc.from("legal_cases").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("deleted_at", null);
    expect(all).toBeGreaterThanOrEqual(3);
    const page = await clients.listClients(await ctxFor("PARTNER_ADMIN_A"), listClientsSchema.parse({ q: "Cliente Portal 4.3.1", pageSize: 50 }));
    const item = page.items.find((c) => c.id === clientId);
    expect(item?.partnerCounts).toMatchObject({ cases: 1 });
  });

  it("parceiro B não recebe o cliente (nem contagem); a equipe interna não recebe contagens do portal", async () => {
    const b = await clients.listClients(await ctxFor("PARTNER_ADMIN_B"), listClientsSchema.parse({ q: "Cliente Portal 4.3.1", pageSize: 50 }));
    expect(b.items.some((c) => c.id === clientId)).toBe(false);
    const internal = await clients.listClients(await ctxFor("LAWYER"), listClientsSchema.parse({ q: "Cliente Portal 4.3.1", pageSize: 50 }));
    expect(internal.items.every((c) => c.partnerCounts === undefined)).toBe(true);
  });
});
