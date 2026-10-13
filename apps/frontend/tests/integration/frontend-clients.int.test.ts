import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema, listClientsSchema, updateClientSchema } from "@/server/domain/clients/schemas";
import * as organizations from "@/server/domain/organizations/service";
import { listOrganizationUsersSchema, listPartnersSchema } from "@/server/domain/organizations/schemas";
import { clientQueryToInput, DEFAULT_CLIENT_QUERY } from "@/features/clients/list-query";
import { emptyIndividualValues } from "@/features/clients/schemas";
import { individualCreateInput, individualPatch } from "@/features/clients/server-input";
import { ctxFor, expectDomainError, fakeCpf, world } from "./support/world";

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
