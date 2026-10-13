import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema, replaceCompanyPeopleSchema } from "@/server/domain/clients/schemas";
import { companyPeopleInput } from "@/features/clients/server-input";
import { companyPeopleToValues, type CompanyPeopleFormValues } from "@/features/clients/schemas";
import type { CompanyClient } from "@/types";
import { ctxFor, dbFor, expectDomainError, fakeCnpj, fakeCpf, serviceDb, world, type WorldRole } from "./support/world";

/**
 * Migration 028 no Supabase DEV: representantes e sócios de Cliente PJ
 * editados pelo ESTADO FINAL das listas, numa operação atômica
 * (replace_company_people), pelo mesmo caminho da tela (formulário →
 * schema → service → RPC).
 */

async function newCompany(): Promise<string> {
  const { id } = await clients.createClient(
    await ctxFor("LAWYER"),
    createClientSchema.parse({
      kind: "COMPANY",
      cnpj: fakeCnpj(),
      legalName: `PJ 028 ${world.run} ${randomUUID().slice(0, 6)}`,
      originOfficeId: world.owner,
      representatives: [
        { name: "Rep Um", cpf: fakeCpf(), role: "Diretor", isPrimary: true },
        { name: "Rep Dois", cpf: fakeCpf(), role: "Procurador", isPrimary: false },
      ],
      partners: [
        { name: "Sócio A", sharePercent: 40 },
        { name: "Sócio B", sharePercent: 30 },
        { name: "Sócio C", sharePercent: 30 },
      ],
    }),
  );
  return id;
}

async function company(role: WorldRole, id: string): Promise<CompanyClient> {
  const detail = await clients.getClient(await ctxFor(role), id);
  if (detail.surface !== "INTERNAL" || detail.client.kind !== "COMPANY") throw new Error("ficha PJ");
  return detail.client;
}

/** Igual à tela: valores do formulário → input da action → schema do servidor → service. */
async function save(role: WorldRole, id: string, edit: (v: CompanyPeopleFormValues) => CompanyPeopleFormValues) {
  const values = edit(companyPeopleToValues(await company("ADMIN", id)));
  return clients.replaceCompanyPeople(await ctxFor(role), replaceCompanyPeopleSchema.parse(companyPeopleInput(id, values)));
}

const people = async (id: string) => {
  const c = await company("ADMIN", id);
  return {
    reps: c.representatives.map((r) => [r.name, r.isPrimary] as const).sort(),
    partners: c.partners.map((p) => [p.name, p.sharePercent ?? null] as const).sort(),
  };
};

const newRep = (name: string, isPrimary = false) => ({ id: "", name, cpf: fakeCpf(), role: "Gerente", email: "", phone: "", isPrimary });

describe("028 — bloco societário de PJ (estado final, atômico)", () => {
  it("ADMIN edita representantes: renomeia, troca o principal, adiciona um novo", async () => {
    const id = await newCompany();
    const r = await save("ADMIN", id, (v) => ({
      ...v,
      representatives: [
        ...v.representatives.map((x) => (x.name === "Rep Dois" ? { ...x, name: "Rep Dois Renomeado", isPrimary: true } : { ...x, isPrimary: false })),
        newRep("Rep Três"),
      ],
    }));
    expect(r.representatives).toEqual({ added: 1, updated: 2, removed: 0 });
    expect((await people(id)).reps).toEqual([["Rep Dois Renomeado", true], ["Rep Três", false], ["Rep Um", false]]);
  });

  it("ADMIN edita sócios: 3 → 2 (um removido, um alterado)", async () => {
    const id = await newCompany();
    const r = await save("ADMIN", id, (v) => ({
      ...v,
      partners: v.partners.filter((p) => p.name !== "Sócio C").map((p) => (p.name === "Sócio A" ? { ...p, sharePercent: "70" } : p)),
    }));
    expect(r.partners).toEqual({ added: 0, updated: 1, removed: 1 });
    expect((await people(id)).partners).toEqual([["Sócio A", 70], ["Sócio B", 30]]);
  });

  it("remover um sócio e adicionar um representante (LAWYER — matriz: clients.edit)", async () => {
    const id = await newCompany();
    await save("LAWYER", id, (v) => ({ representatives: [...v.representatives, newRep("Rep Novo")], partners: v.partners.slice(1) }));
    const p = await people(id);
    expect(p.reps.map(([n]) => n)).toContain("Rep Novo");
    expect(p.partners).toHaveLength(2);
  });

  it("ASSISTANT segue a matriz (clients.edit): pode alterar", async () => {
    const id = await newCompany();
    await save("ASSISTANT", id, (v) => ({ ...v, partners: [...v.partners, { id: "", name: "Sócio D", document: "", qualification: "", sharePercent: "" }] }));
    expect((await people(id)).partners).toHaveLength(4);
  });

  it("parceiro não altera — nem pelo service, nem chamando a RPC direto", async () => {
    const id = await newCompany();
    const before = await people(id);
    await expectDomainError(clients.replaceCompanyPeople(await ctxFor("PARTNER_ADMIN_A"), replaceCompanyPeopleSchema.parse({ clientId: id, representatives: [], partners: [] })), "FORBIDDEN");
    for (const role of ["PARTNER_ADMIN_A", "PARTNER_USER_A"] as const) {
      const { error } = await dbFor(role).rpc("replace_company_people", { p_client_id: id, p_representatives: [], p_shareholders: [] });
      expect(error?.code).toBe("42501");
    }
    expect(await people(id)).toEqual(before);
  });

  it("Cliente PF recusa a operação", async () => {
    const { id } = await clients.createClient(
      await ctxFor("LAWYER"),
      createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "PF 028", originOfficeId: world.owner }),
    );
    await expectDomainError(
      clients.replaceCompanyPeople(await ctxFor("ADMIN"), replaceCompanyPeopleSchema.parse({ clientId: id, representatives: [], partners: [] })),
      "INVALID_STATE",
      /pessoa jurídica/,
    );
  });

  it("payload parcialmente inválido (CNPJ de sócio ruim no fim): nada é removido nem gravado", async () => {
    const id = await newCompany();
    const before = await people(id);
    const c = await company("ADMIN", id);
    // O schema do servidor já recusaria; aqui o erro vem do BANCO (RPC direta), depois de remover/alterar em memória.
    const { error } = await dbFor("ADMIN").rpc("replace_company_people", {
      p_client_id: id,
      p_representatives: [{ id: c.representatives[0].id, name: "Mudou", is_primary: true }],
      p_shareholders: [{ name: "Novo" }, { name: "Doc Ruim", document: "123" }],
    });
    expect(error).not.toBeNull();
    expect(await people(id)).toEqual(before);
  });

  it("IDOR: id de representante de OUTRA PJ é recusado e as duas ficam intactas", async () => {
    const [mine, other] = [await newCompany(), await newCompany()];
    const foreign = (await company("ADMIN", other)).representatives[0].id;
    const before = [await people(mine), await people(other)];
    const c = await company("ADMIN", mine);
    const input = {
      clientId: mine,
      representatives: [...c.representatives.map((r) => ({ id: r.id, name: r.name, isPrimary: false })), { id: foreign, name: "Sequestro", isPrimary: true }],
      partners: [],
    };
    await expectDomainError(clients.replaceCompanyPeople(await ctxFor("ADMIN"), replaceCompanyPeopleSchema.parse(input)), "INVALID_STATE", /não pertence/);
    expect([await people(mine), await people(other)]).toEqual(before);
  });

  it("cliente inexistente: não encontrado (FORBIDDEN, sem revelar nada)", async () => {
    await expectDomainError(
      clients.replaceCompanyPeople(await ctxFor("ADMIN"), replaceCompanyPeopleSchema.parse({ clientId: randomUUID(), representatives: [], partners: [] })),
      "FORBIDDEN",
    );
  });

  it("auditoria: evento-resumo com ator, escritório e request_id; sem nome nem CPF", async () => {
    const id = await newCompany();
    const ctx = await ctxFor("ADMIN");
    const values = companyPeopleToValues(await company("ADMIN", id));
    const cpf = fakeCpf();
    await clients.replaceCompanyPeople(
      ctx,
      replaceCompanyPeopleSchema.parse(companyPeopleInput(id, { ...values, representatives: [...values.representatives, { ...newRep("Rep Auditado"), cpf }] })),
    );
    const { data } = await serviceDb()
      .from("audit_events")
      .select("action, actor_user_id, actor_organization_id, request_id, metadata, created_at")
      .eq("entity_id", id)
      .eq("request_id", ctx.requestId);
    const summary = data?.find((e) => e.action === "COMPANY_PEOPLE_REPLACED");
    expect(summary).toMatchObject({ actor_user_id: world.users.ADMIN.id, actor_organization_id: world.owner, request_id: ctx.requestId });
    expect(summary?.metadata).toMatchObject({ representatives: { added: 1, updated: 0, removed: 0, total: 3 } });
    expect(summary?.created_at).toBeTruthy();
    expect(JSON.stringify(data)).not.toMatch(new RegExp(`Rep Auditado|${cpf}`));
  });
});
