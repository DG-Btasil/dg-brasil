import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as orgs from "@/server/domain/organizations/service";
import { createPartnerSchema, listOrganizationUsersSchema, listPartnersSchema, updateOwnerOfficeSchema } from "@/server/domain/organizations/schemas";
import { ctxFor, expectDomainError, fakeCnpj, fakeCpf, serviceDb, world } from "./support/world";

/** Organizações no Supabase DEV real: parceiros (ADMIN), divisão × snapshot, OWNER protegido, isolamento A × B. */

let seq = 0;
const newPartner = (over: Record<string, unknown> = {}) =>
  createPartnerSchema.parse({
    name: `Parceiro Int ${world.run} ${++seq}`,
    cnpj: fakeCnpj(),
    email: "Contato.Parceiro@DGBRASIL.TEST",
    responsibleName: "Dra. Responsável Teste",
    responsibleOab: { number: "123456", state: "SP" },
    notes: "nota interna do parceiro",
    ...over,
  });

describe("parceiros — ADMIN", () => {
  it("cria organização PARTNER (PENDING) + divisão padrão; nunca OWNER", async () => {
    const admin = await ctxFor("ADMIN");
    const { id } = await orgs.createPartner(admin, newPartner({ type: "OWNER", partnershipPercentage: 40, ownerPercentage: 60 }));

    const db = serviceDb();
    const { data: org } = await db.from("organizations").select("type, status, email").eq("id", id).single();
    expect(org).toEqual({ type: "PARTNER", status: "PENDING", email: "contato.parceiro@dgbrasil.test" });
    const { data: settings } = await db.from("partner_office_settings").select("default_partner_percentage, default_owner_percentage, partnership_active").eq("organization_id", id).single();
    expect(Number(settings?.default_partner_percentage)).toBe(40);
    expect(Number(settings?.default_owner_percentage)).toBe(60);
    expect(settings?.partnership_active).toBe(true);

    const detail = await orgs.getPartner(admin, id);
    expect(detail.access).toBe("ADMIN");
    if (detail.access !== "ADMIN") throw new Error("ficha");
    expect(detail.partner).toMatchObject({ status: "PENDING_INVITE", partnershipPercentage: 40, ownerPercentage: 60, notes: "nota interna do parceiro", oabState: "SP" });

    const list = await orgs.listPartners(admin, listPartnersSchema.parse({ q: `Parceiro Int ${world.run}`, pageSize: 50 }));
    expect(list.items.find((p) => p.id === id)?.share).toEqual({ partnershipPercentage: 40, ownerPercentage: 60, partnershipActive: true });
  });

  it("create_partner_office é atômica: divisão inválida não deixa organização órfã", async () => {
    const { db } = await ctxFor("ADMIN");
    const name = `Parceiro Atômico ${world.run}`;
    const { error } = await db.rpc("create_partner_office", {
      p_org: { name },
      p_settings: { default_partner_percentage: 40, default_owner_percentage: 50 },
    });
    expect(error).not.toBeNull();
    const { count } = await serviceDb().from("organizations").select("id", { count: "exact", head: true }).eq("name", name);
    expect(count).toBe(0);
  });

  it("a RPC recusa quem não é ADMIN, mesmo chamada direto", async () => {
    for (const role of ["LAWYER", "PARTNER_ADMIN_A"] as const) {
      const { db } = await ctxFor(role);
      const name = `Parceiro Proibido ${world.run} ${role}`;
      const { error } = await db.rpc("create_partner_office", { p_org: { name }, p_settings: {} });
      expect(error?.code).toBe("42501");
      const { count } = await serviceDb().from("organizations").select("id", { count: "exact", head: true }).eq("name", name);
      expect(count).toBe(0);
    }
  });

  it("CNPJ repetido é CONFLICT com mensagem própria", async () => {
    const admin = await ctxFor("ADMIN");
    const cnpj = fakeCnpj();
    await orgs.createPartner(admin, newPartner({ cnpj }));
    await expectDomainError(orgs.createPartner(admin, newPartner({ cnpj })), "CONFLICT", /CNPJ/);
  });

  it("edição do cadastro e da configuração", async () => {
    const admin = await ctxFor("ADMIN");
    const { id } = await orgs.createPartner(admin, newPartner());
    await orgs.updatePartner(admin, { id, patch: { phone: "1144445555", notes: "nota revisada", partnershipActive: false } });
    const detail = await orgs.getPartner(admin, id);
    expect(detail.access === "ADMIN" && detail.partner).toMatchObject({ phone: "1144445555", notes: "nota revisada", partnershipActive: false });
  });

  it("LAWYER lista e abre parceiro sem divisão/notas, mas não cria nem altera", async () => {
    const { id } = await orgs.createPartner(await ctxFor("ADMIN"), newPartner());
    const lawyer = await ctxFor("LAWYER");
    await expectDomainError(orgs.createPartner(lawyer, newPartner()), "FORBIDDEN");
    await expectDomainError(orgs.changePartnerShare(lawyer, { id, partnershipPercentage: 10, ownerPercentage: 90 }), "FORBIDDEN");
    await expectDomainError(orgs.setPartnerStatus(lawyer, { id, status: "SUSPENDED" }), "FORBIDDEN");

    const detail = await orgs.getPartner(lawyer, id);
    expect(detail.access).toBe("INTERNAL");
    for (const field of ["notes", "partnershipPercentage", "ownerPercentage", "responsibleName"]) expect(detail.partner).not.toHaveProperty(field);
    const list = await orgs.listPartners(lawyer, listPartnersSchema.parse({ q: `Parceiro Int ${world.run}`, pageSize: 50 }));
    expect(list.items.map((p) => p.id)).toContain(id);
    expect(list.items.every((p) => p.share === undefined)).toBe(true);

    await expectDomainError(orgs.listPartners(await ctxFor("ASSISTANT"), listPartnersSchema.parse({})), "FORBIDDEN");
  });
});

describe("divisão padrão × snapshot do caso", () => {
  it("mudar a divisão padrão não altera case_partnership_agreements existentes", async () => {
    const admin = await ctxFor("ADMIN");
    const { id: partnerId } = await orgs.createPartner(admin, newPartner({ partnershipPercentage: 50, ownerPercentage: 50 }));
    await orgs.setPartnerStatus(admin, { id: partnerId, status: "ACTIVE" });

    // Cenário: cliente real (service de clientes) + caso já aceito com origem neste parceiro.
    const { id: clientId } = await clients.createClient(
      await ctxFor("LAWYER"),
      createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Cliente Snapshot", originOfficeId: world.owner }),
    );
    const db = serviceDb();
    const { data: legalCase, error } = await db
      .from("legal_cases")
      .insert({
        client_id: clientId,
        legal_area_id: world.bankingAreaId,
        title: `Caso snapshot ${world.run}`,
        status: "ACCEPTED",
        origin_organization_id: partnerId,
        created_by_organization_id: world.owner,
        assigned_lawyer_id: world.users.LAWYER.id,
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    const caseId = (legalCase as { id: string }).id;

    const readAgreement = async () => {
      const { data } = await db.from("case_partnership_agreements").select("id, partner_percentage, owner_percentage, cancelled_at").eq("legal_case_id", caseId);
      return data ?? [];
    };
    const before = await readAgreement();
    expect(before).toHaveLength(1);
    expect(Number(before[0].partner_percentage)).toBe(50);

    await orgs.changePartnerShare(admin, { id: partnerId, partnershipPercentage: 30, ownerPercentage: 70 });

    const after = await readAgreement();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(Number(after[0].partner_percentage)).toBe(50);
    expect(Number(after[0].owner_percentage)).toBe(50);
    expect(after[0].cancelled_at).toBeNull();

    const detail = await orgs.getPartner(admin, partnerId);
    expect(detail.access === "ADMIN" && [detail.partner.partnershipPercentage, detail.partner.ownerPercentage]).toEqual([30, 70]);

    const { data: audit } = await db.from("audit_events").select("metadata").eq("entity_id", partnerId).eq("action", "PARTNER_SHARE_CHANGED");
    expect((audit?.[0]?.metadata as { preserved_agreements?: number })?.preserved_agreements).toBeGreaterThanOrEqual(1);
  });
});

describe("escritório proprietário", () => {
  it("OWNER não pode ser suspenso: erro do banco mapeado (INVALID_STATE)", async () => {
    const admin = await ctxFor("ADMIN");
    await expectDomainError(orgs.setPartnerStatus(admin, { id: world.owner, status: "SUSPENDED" }), "INVALID_STATE", /proprietário/);
    await expectDomainError(orgs.setPartnerStatus(admin, { id: world.owner, status: "INACTIVE" }), "INVALID_STATE", /proprietário/);
    const { data } = await serviceDb().from("organizations").select("status").eq("id", world.owner).single();
    expect(data?.status).toBe("ACTIVE");
  });

  it("equipe interna lê a ficha; só ADMIN altera; parceiro vê só a identificação", async () => {
    const assistant = await ctxFor("ASSISTANT");
    const office = await orgs.getOwnerOffice(assistant);
    expect(office.surface).toBe("INTERNAL");
    if (office.surface !== "INTERNAL") throw new Error("ficha");
    expect(office.office.id).toBe(world.owner);

    await expectDomainError(orgs.updateOwnerOffice(await ctxFor("LAWYER"), updateOwnerOfficeSchema.parse({ units: ["X"] })), "FORBIDDEN");
    // Regrava o mesmo valor (não altera o DEV compartilhado).
    const admin = await ctxFor("ADMIN");
    await orgs.updateOwnerOffice(admin, updateOwnerOfficeSchema.parse({ statesOfPractice: office.office.statesOfPractice }));
    const again = await orgs.getOwnerOffice(admin);
    expect(again.surface === "INTERNAL" && again.office.statesOfPractice).toEqual(office.office.statesOfPractice);

    const partnerView = await orgs.getOwnerOffice(await ctxFor("PARTNER_USER_A"));
    expect(partnerView.surface).toBe("PARTNER");
    expect(Object.keys(partnerView.office).sort()).toEqual(expect.arrayContaining(["id", "name"]));
    expect(partnerView.office).not.toHaveProperty("principalLawyer");
  });
});

describe("Portal do Parceiro (A × B)", () => {
  it("PARTNER_ADMIN A lê o próprio escritório, sem dado interno, e não o de B", async () => {
    // Dado interno gravado no parceiro A pelo ADMIN.
    await orgs.updatePartner(await ctxFor("ADMIN"), { id: world.partnerA, patch: { notes: "não pode vazar ao parceiro" } });

    const a = await ctxFor("PARTNER_ADMIN_A");
    const own = await orgs.getPartner(a, world.partnerA);
    expect(own.access).toBe("PARTNER");
    expect(own.partner.id).toBe(world.partnerA);
    const json = JSON.stringify(own);
    expect(json).not.toContain("não pode vazar");
    for (const field of ["notes", "partnershipPercentage", "ownerPercentage", "responsibleName", "officeId"]) expect(own.partner).not.toHaveProperty(field);

    await expectDomainError(orgs.getPartner(a, world.partnerB), "NOT_FOUND");
    expect((await orgs.getMyPartnerOffice(await ctxFor("PARTNER_USER_A"))).partner.id).toBe(world.partnerA);
    expect((await orgs.getMyPartnerOffice(await ctxFor("PARTNER_USER_B"))).partner.id).toBe(world.partnerB);
  });

  it("parceiro não lista, cria nem altera parceiros", async () => {
    const a = await ctxFor("PARTNER_ADMIN_A");
    await expectDomainError(orgs.listPartners(a, listPartnersSchema.parse({})), "FORBIDDEN");
    await expectDomainError(orgs.createPartner(a, newPartner()), "FORBIDDEN");
    await expectDomainError(orgs.updatePartner(a, { id: world.partnerA, patch: { phone: "1100000000" } }), "FORBIDDEN");
    await expectDomainError(orgs.changePartnerShare(a, { id: world.partnerA, partnershipPercentage: 99, ownerPercentage: 1 }), "FORBIDDEN");
    await expectDomainError(orgs.setPartnerStatus(a, { id: world.partnerB, status: "SUSPENDED" }), "FORBIDDEN");
  });
});

describe("usuários (leitura)", () => {
  it("equipe interna lê o proprietário; parceiro só o próprio escritório", async () => {
    const lawyer = await ctxFor("LAWYER");
    const internal = await orgs.listOrganizationUsers(lawyer, listOrganizationUsersSchema.parse({ role: "LAWYER", sortDirection: "desc", pageSize: 50 }));
    expect(internal.items.map((u) => u.userId)).toContain(world.users.LAWYER.id);
    expect(internal.items[0]).not.toHaveProperty("email");

    const partnerA = await orgs.listOrganizationUsers(await ctxFor("PARTNER_USER_A"), listOrganizationUsersSchema.parse({}));
    const ids = partnerA.items.map((u) => u.userId);
    expect(ids).toEqual(expect.arrayContaining([world.users.PARTNER_ADMIN_A.id, world.users.PARTNER_USER_A.id]));
    expect(ids).not.toContain(world.users.PARTNER_ADMIN_B.id);
    expect(partnerA.items.every((u) => u.organizationId === world.partnerA)).toBe(true);

    await expectDomainError(orgs.listOrganizationUsers(await ctxFor("PARTNER_USER_A"), listOrganizationUsersSchema.parse({ organizationId: world.partnerB })), "FORBIDDEN");
    await expectDomainError(orgs.listOrganizationUsers(await ctxFor("ASSISTANT"), listOrganizationUsersSchema.parse({ organizationId: world.partnerA })), "FORBIDDEN");
    const viaLawyer = await orgs.listOrganizationUsers(lawyer, listOrganizationUsersSchema.parse({ organizationId: world.partnerB }));
    expect(viaLawyer.items.map((u) => u.userId)).toContain(world.users.PARTNER_USER_B.id);
  });
});
