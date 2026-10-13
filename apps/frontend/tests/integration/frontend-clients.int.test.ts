import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema, listClientsSchema, updateClientSchema } from "@/server/domain/clients/schemas";
import * as organizations from "@/server/domain/organizations/service";
import { listOrganizationUsersSchema, listPartnersSchema } from "@/server/domain/organizations/schemas";
import { clientQueryToInput, DEFAULT_CLIENT_QUERY } from "@/features/clients/list-query";
import { emptyIndividualValues } from "@/features/clients/schemas";
import { individualCreateInput, individualPatch } from "@/features/clients/server-input";
import { ctxFor, dbFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3 — Fase A no Supabase DEV: o que a TELA de clientes gera (URL da
 * lista, formulário de cadastro, PATCH da edição) passa pelos schemas e
 * services reais, e o diretório (responsáveis/origens) carrega por papel.
 */

const form = (cpf: string, name: string) => ({
  ...emptyIndividualValues(world.users.LAWYER.id, world.owner),
  fullName: name,
  cpf,
  phone: "(11) 99999-0000",
  socialName: "Apelido UI",
  address: { zipCode: "01001-000", street: "Praça da Sé", number: "1", complement: "", district: "Sé", city: "São Paulo", state: "sp", country: "Brasil" },
});

describe("Fase A — clientes pela UI", () => {
  it("cadastro pelo formulário → ficha real; edição apaga texto e mantém o documento", async () => {
    const lawyer = await ctxFor("LAWYER");
    const cpf = fakeCpf();
    const { id } = await clients.createClient(lawyer, createClientSchema.parse(individualCreateInput(form(cpf, `Cliente UI ${world.run}`))));
    const created = await clients.getClient(lawyer, id);
    if (created.surface !== "INTERNAL" || created.client.kind !== "INDIVIDUAL") throw new Error("ficha");
    expect(created.client).toMatchObject({ socialName: "Apelido UI", responsibleUserId: world.users.LAWYER.id, originOfficeId: world.owner });
    expect(created.client.address).toMatchObject({ zipCode: "01001000", state: "SP", country: "BR" });

    const patch = individualPatch({ ...form(cpf, `Cliente UI ${world.run} editado`), socialName: "", address: { ...form(cpf, "").address, zipCode: "", street: "", number: "", district: "", city: "", state: "" } }, created.client);
    await clients.updateClient(lawyer, updateClientSchema.parse({ id, patch }));
    const edited = await clients.getClient(lawyer, id);
    if (edited.surface !== "INTERNAL" || edited.client.kind !== "INDIVIDUAL") throw new Error("ficha");
    expect(edited.client.fullName).toBe(`Cliente UI ${world.run} editado`);
    expect(edited.client.socialName).toBeUndefined();
    expect(edited.client.address).toBeUndefined();
    expect(edited.client.cpf).toBe(cpf);
  });

  it("LAWYER não corrige CPF mesmo forçando o PATCH (só ADMIN)", async () => {
    const lawyer = await ctxFor("LAWYER");
    const cpf = fakeCpf();
    const { id } = await clients.createClient(lawyer, createClientSchema.parse(individualCreateInput(form(cpf, "Cliente Documento UI"))));
    const detail = await clients.getClient(lawyer, id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha");
    const patch = individualPatch(form(fakeCpf(), "Cliente Documento UI"), detail.client);
    expect(patch).toHaveProperty("document");
    await expectDomainError(clients.updateClient(lawyer, updateClientSchema.parse({ id, patch })), "FORBIDDEN");
  });

  it("URL da lista → listClientsAction: página, situação e busca por nome", async () => {
    const lawyer = await ctxFor("LAWYER");
    const name = `Lista UI ${world.run}`;
    const { id } = await clients.createClient(lawyer, createClientSchema.parse(individualCreateInput(form(fakeCpf(), name))));
    const page = await clients.listClients(lawyer, listClientsSchema.parse(clientQueryToInput({ ...DEFAULT_CLIENT_QUERY, search: name, lifecycle: "active" })));
    expect(page.items.map((c) => c.id)).toContain(id);
    expect(page.pageSize).toBe(25);
    const inactive = await clients.listClients(lawyer, listClientsSchema.parse(clientQueryToInput({ ...DEFAULT_CLIENT_QUERY, search: name, lifecycle: "inactive" })));
    expect(inactive.items.map((c) => c.id)).not.toContain(id);
  });
});

describe("Fase A — PF: apagar data de nascimento, gênero, estado civil e documento", () => {
  const columns = async (id: string) =>
    (
      await serviceDb()
        .from("individual_client_details")
        .select("birth_date, gender, marital_status, identity_document_type, identity_document_number, identity_document_issuer, identity_document_state, profession")
        .eq("client_id", id)
        .single()
    ).data;

  async function filledClient() {
    const lawyer = await ctxFor("LAWYER");
    const values = { ...form(fakeCpf(), "PF Limpeza UI"), birthDate: "1980-02-03", gender: "MALE" as const, maritalStatus: "SINGLE", idType: "RG", idNumber: "7654321", idIssuer: "SSP", idState: "SP" };
    const { id } = await clients.createClient(lawyer, createClientSchema.parse(individualCreateInput(values)));
    return { id, values };
  }

  it("valor existente → limpo na tela → NULL no banco → a ficha (releitura) volta vazia; preencher de novo funciona", async () => {
    const { id, values } = await filledClient();
    const lawyer = await ctxFor("LAWYER");
    const detail = await clients.getClient(lawyer, id);
    if (detail.surface !== "INTERNAL") throw new Error("ficha");
    // Como a tela: os quatro controles esvaziados.
    const cleared = { ...values, birthDate: "", gender: "" as const, maritalStatus: "", idType: "", idNumber: "", idIssuer: "", idState: "" };
    await clients.updateClient(lawyer, updateClientSchema.parse({ id, patch: individualPatch(cleared, detail.client) }));
    expect(await columns(id)).toMatchObject({
      birth_date: null,
      gender: null,
      marital_status: null,
      identity_document_type: null,
      identity_document_number: null,
      identity_document_issuer: null,
      identity_document_state: null,
    });
    // "Recarregar a página": nova leitura pelo service mostra os campos vazios.
    const reread = await clients.getClient(await ctxFor("LAWYER"), id);
    if (reread.surface !== "INTERNAL" || reread.client.kind !== "INDIVIDUAL") throw new Error("ficha");
    expect([reread.client.birthDate, reread.client.gender, reread.client.maritalStatus, reread.client.identityDocument]).toEqual([undefined, undefined, undefined, undefined]);

    await clients.updateClient(lawyer, updateClientSchema.parse({ id, patch: individualPatch({ ...values, birthDate: "1981-04-05" }, reread.client) }));
    expect(await columns(id)).toMatchObject({ birth_date: "1981-04-05", gender: "MALE", marital_status: "SINGLE", identity_document_number: "7654321" });
  });

  it("alterar outro campo sem enviar os quatro não apaga nenhum", async () => {
    const { id } = await filledClient();
    await clients.updateClient(await ctxFor("ASSISTANT"), updateClientSchema.parse({ id, patch: { profession: "Mestre de obras", birthDate: undefined } }));
    expect(await columns(id)).toMatchObject({ birth_date: "1980-02-03", gender: "MALE", marital_status: "SINGLE", identity_document_type: "RG", profession: "Mestre de obras" });
  });

  it("parceiro continua sem editar dado de PF (service e RPC direta)", async () => {
    const { id } = await filledClient();
    await expectDomainError(clients.updateClient(await ctxFor("PARTNER_ADMIN_A"), updateClientSchema.parse({ id, patch: { birthDate: null } })), "FORBIDDEN");
    const { error } = await dbFor("PARTNER_ADMIN_A").rpc("save_client", { p_id: id, p: { birth_date: null } });
    expect(error).not.toBeNull();
    expect((await columns(id))?.birth_date).toBe("1980-02-03");
  });

  it("auditoria da limpeza: campos alterados, sem data nem número do documento", async () => {
    const { id } = await filledClient();
    const ctx = await ctxFor("ADMIN");
    await clients.updateClient(ctx, updateClientSchema.parse({ id, patch: { birthDate: null, identityDocument: null } }));
    const { data } = await serviceDb().from("audit_events").select("action, actor_user_id, metadata").eq("entity_id", id).eq("request_id", ctx.requestId);
    const event = data?.find((e) => e.action === "CLIENT_UPDATED" && (e.metadata as { table?: string }).table === "individual_client_details");
    expect(event?.actor_user_id).toBe(world.users.ADMIN.id);
    expect((event?.metadata as { fields: string[] }).fields).toEqual(expect.arrayContaining(["birth_date", "identity_document_number"]));
    expect(JSON.stringify(data)).not.toMatch(/1980-02-03|7654321/);
  });
});

describe("Fase A — diretório da organização (responsáveis e origens)", () => {
  it("interno: integrantes do próprio escritório; parceiros só com partners.view", async () => {
    for (const role of ["ADMIN", "LAWYER", "ASSISTANT"] as const) {
      const ctx = await ctxFor(role);
      const users = await organizations.listOrganizationUsers(ctx, listOrganizationUsersSchema.parse({ pageSize: 50 }));
      expect(users.items.every((u) => u.organizationId === world.owner)).toBe(true);
      expect(users.items.map((u) => u.userId)).toContain(world.users[role].id);
    }
    const partners = await organizations.listPartners(await ctxFor("LAWYER"), listPartnersSchema.parse({ pageSize: 50 }));
    expect(partners.items.map((p) => p.id)).toEqual(expect.arrayContaining([world.partnerA, world.partnerB]));
    // ASSISTANT não lista parceiros: a tela mostra só o escritório proprietário como origem.
    await expectDomainError(organizations.listPartners(await ctxFor("ASSISTANT"), listPartnersSchema.parse({ pageSize: 50 })), "FORBIDDEN");
  });

  it("parceiro: só a própria equipe; nunca a do outro parceiro", async () => {
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const users = await organizations.listOrganizationUsers(pa, listOrganizationUsersSchema.parse({ pageSize: 50 }));
    expect(users.items.every((u) => u.organizationId === world.partnerA)).toBe(true);
    await expectDomainError(organizations.listOrganizationUsers(pa, listOrganizationUsersSchema.parse({ organizationId: world.partnerB })), "FORBIDDEN");
  });
});
