import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema, listClientsSchema } from "@/server/domain/clients/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/** Clientes no Supabase DEV real: deduplicação canônica, isolamento A × B, DTO por superfície. */

const newIndividual = (cpf: string, name = "Cliente Integração") =>
  createClientSchema.parse({
    kind: "INDIVIDUAL",
    cpf,
    fullName: name,
    originOfficeId: world.owner,
    contact: { email: "cliente.integracao@dgbrasil.test", phone: "11999990000" },
    address: { zipCode: "01001000", city: "São Paulo", state: "SP" },
    notes: "nota interna sigilosa",
  });

describe("clientes — equipe interna", () => {
  it("ASSISTANT cria; ficha interna traz dados internos; acesso LGPD é registrado", async () => {
    const ctx = await ctxFor("ASSISTANT");
    const cpf = fakeCpf();
    const { id } = await clients.createClient(ctx, newIndividual(cpf));
    const detail = await clients.getClient(ctx, id);
    expect(detail.surface).toBe("INTERNAL");
    if (detail.surface !== "INTERNAL" || detail.client.kind !== "INDIVIDUAL") throw new Error("ficha");
    expect(detail.client.cpf).toBe(cpf);
    expect(detail.client.notes).toBe("nota interna sigilosa");
    expect(detail.client.contact.email).toBe("cliente.integracao@dgbrasil.test");
    const { data: access } = await serviceDb()
      .from("personal_data_access_events")
      .select("action, resource_type, request_id")
      .eq("client_id", id)
      .eq("actor_user_id", world.users.ASSISTANT.id);
    expect(access?.[0]).toMatchObject({ action: "VIEW_DETAIL", resource_type: "CLIENT" });
  });

  it("mesmo CPF não cria segundo cliente (DUPLICATE_CLIENT), nem em corrida", async () => {
    const ctx = await ctxFor("LAWYER");
    const cpf = fakeCpf();
    await clients.createClient(ctx, newIndividual(cpf));
    await expectDomainError(clients.createClient(ctx, newIndividual(cpf, "Outro Nome")), "DUPLICATE_CLIENT");
    const race = await Promise.allSettled([clients.createClient(ctx, newIndividual(fakeCpf())), clients.createClient(ctx, newIndividual(cpf))]);
    expect(race[1].status).toBe("rejected");
    const { count } = await serviceDb().from("clients").select("id", { count: "exact", head: true }).eq("cpf", cpf);
    expect(count).toBe(1);
  });

  it("busca paginada por nome e por documento", async () => {
    const ctx = await ctxFor("LAWYER");
    const cpf = fakeCpf();
    const name = `Busca ${world.run} Ímpar`;
    const { id } = await clients.createClient(ctx, newIndividual(cpf, name));
    const byName = await clients.listClients(ctx, listClientsSchema.parse({ q: `busca ${world.run}`, pageSize: 5 }));
    expect(byName.items.map((c) => c.id)).toContain(id);
    expect(byName.pageSize).toBe(5);
    const byDoc = await clients.listClients(ctx, listClientsSchema.parse({ q: cpf.slice(0, 9) }));
    expect(byDoc.items.map((c) => c.id)).toContain(id);
    // Curinga do usuário não vira padrão.
    const wildcard = await clients.listClients(ctx, listClientsSchema.parse({ q: "%", pageSize: 5 }));
    expect(wildcard.items.every((c) => c.name.includes("%"))).toBe(true);
  });

  it("ASSISTANT não corrige CPF; ADMIN corrige", async () => {
    const assistant = await ctxFor("ASSISTANT");
    const { id } = await clients.createClient(assistant, newIndividual(fakeCpf()));
    await expectDomainError(clients.updateClient(assistant, { id, patch: { document: fakeCpf() } }), "FORBIDDEN");
    const admin = await ctxFor("ADMIN");
    const novo = fakeCpf();
    await clients.updateClient(admin, { id, patch: { document: novo } });
    const detail = await clients.getClient(admin, id);
    expect(detail.surface === "INTERNAL" && detail.client.kind === "INDIVIDUAL" && detail.client.cpf).toBe(novo);
  });

  it("inativar/reativar (interno) e excluir só ADMIN", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { id } = await clients.createClient(lawyer, newIndividual(fakeCpf()));
    await clients.inactivateClient(lawyer, { id, reason: "CLIENT_GAVE_UP", note: "desistiu" });
    const detail = await clients.getClient(lawyer, id);
    expect(detail.surface === "INTERNAL" && detail.client.status).toBe("INACTIVE");
    await clients.reactivateClient(lawyer, id);
    await expectDomainError(clients.removeClient(lawyer, id), "FORBIDDEN");
    await clients.removeClient(await ctxFor("ADMIN"), id);
    await expectDomainError(clients.getClient(lawyer, id), "NOT_FOUND");
  });
});

describe("clientes — Portal do Parceiro (A × B)", () => {
  it("parceiro não cria cliente direto (só pelo envio de caso)", async () => {
    await expectDomainError(clients.createClient(await ctxFor("PARTNER_ADMIN_A"), newIndividual(fakeCpf())), "FORBIDDEN");
  });

  it("consulta de CPF: EXISTS sem id/nome para cliente de outro escritório; NOT_FOUND para inexistente", async () => {
    const cpf = fakeCpf();
    await clients.createClient(await ctxFor("LAWYER"), newIndividual(cpf, "Só do Proprietário"));
    const partner = await ctxFor("PARTNER_ADMIN_A");
    expect(await clients.lookupClientDocument(partner, cpf)).toEqual({ status: "EXISTS" });
    expect(await clients.lookupClientDocument(partner, fakeCpf())).toEqual({ status: "NOT_FOUND" });
  });

  it("parceiro A não lista nem abre cliente sem relacionamento (IDOR) e B não vê o de A", async () => {
    const internal = await ctxFor("LAWYER");
    const { id } = await clients.createClient(internal, newIndividual(fakeCpf(), "Cliente Interno Isolado"));
    const a = await ctxFor("PARTNER_USER_A");
    await expectDomainError(clients.getClient(a, id), "NOT_FOUND");
    const list = await clients.listClients(a, listClientsSchema.parse({ pageSize: 50 }));
    expect(list.items.map((c) => c.id)).not.toContain(id);
    await expectDomainError(clients.updateClientBasics(await ctxFor("PARTNER_ADMIN_B"), { id, contact: { phone: "1100000000" } }), "FORBIDDEN");
  });

  it("ficha do parceiro (cliente relacionado) não tem nenhum campo interno", async () => {
    // Relaciona o cliente ao parceiro A pelo caminho real: caso do próprio escritório.
    const cpf = fakeCpf();
    const db = (await ctxFor("PARTNER_ADMIN_A")).db;
    const { data, error } = await db.rpc("partner_submit_case", {
      p_client: { document: cpf, kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente do Parceiro A" },
      p_case: { legal_area_id: world.bankingAreaId, title: "Caso integração", origin_organization_id: world.partnerA },
    });
    expect(error).toBeNull();
    const clientId = (data as { client_id: string }).client_id;
    // Equipe interna escreve dado interno no mesmo cliente.
    await clients.updateClient(await ctxFor("LAWYER"), { id: clientId, patch: { notes: "não pode vazar" } });

    const detail = await clients.getClient(await ctxFor("PARTNER_USER_A"), clientId);
    expect(detail.surface).toBe("PARTNER");
    const json = JSON.stringify(detail);
    expect(json).not.toContain("não pode vazar");
    for (const field of ["notes", "legalSummary", "inactivation", "responsibleUserId", "representatives", "partners"]) {
      expect(detail.client).not.toHaveProperty(field);
    }
    // Parceiro B não abre o cliente de A.
    await expectDomainError(clients.getClient(await ctxFor("PARTNER_USER_B"), clientId), "NOT_FOUND");
    // Relacionamentos: A só vê o próprio vínculo.
    const rel = await clients.listClientRelationships(await ctxFor("PARTNER_ADMIN_A"), clientId);
    expect(rel.map((r) => r.organizationId)).toEqual([world.partnerA]);
  });

  it("parceiro altera só contato e endereço do próprio cliente", async () => {
    const db = (await ctxFor("PARTNER_ADMIN_A")).db;
    const { data } = await db.rpc("partner_submit_case", {
      p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Contato Parceiro" },
      p_case: { legal_area_id: world.bankingAreaId, title: "Caso contato", origin_organization_id: world.partnerA },
    });
    const clientId = (data as { client_id: string }).client_id;
    const pa = await ctxFor("PARTNER_ADMIN_A");
    await clients.updateClientBasics(pa, { id: clientId, contact: { phone: "1133332222" }, address: { city: "Santos", state: "SP" } });
    const detail = await clients.getClient(pa, clientId);
    expect(detail.client.contact.phone).toBe("1133332222");
    expect(detail.client.address?.city).toBe("Santos");
  });
});
