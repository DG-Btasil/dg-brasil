import { describe, expect, it } from "vitest";
import { callAction, mapFieldErrors, NETWORK_ERROR_MESSAGE, referenceCode } from "@/lib/actions/result";
import { companyPeoplePayload } from "@/server/domain/clients/mappers";
import { createClientSchema, replaceCompanyPeopleSchema, updateClientSchema } from "@/server/domain/clients/schemas";
import type { Client } from "@/types";
import {
  clientQueryFromSearchParams,
  clientQueryToInput,
  clientQueryToSearchParams,
  DEFAULT_CLIENT_QUERY,
  hasClientFilters,
  type ClientListQuery,
} from "./list-query";
import { companyPeopleSchema, emptyCompanyValues, emptyIndividualValues, fromAddress, newPartner, newRepresentative } from "./schemas";
import { CLIENT_FIELD_MAP, companyCreateInput, companyPatch, companyPeopleInput, countryCode, individualCreateInput, individualPatch } from "./server-input";

const ORG = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const USER = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

/* ------------------------------------------------------------------ */
/* Lista: URL ↔ filtros ↔ entrada da action                            */
/* ------------------------------------------------------------------ */

describe("lista de clientes — estado na URL", () => {
  it("ida e volta: filtros, ordem e página sobrevivem a recarregar", () => {
    const q: ClientListQuery = { search: "Maria", lifecycle: "inactive", kind: "COMPANY", responsible: USER, origin: ORG, sort: "name", direction: "asc", page: 3 };
    expect(clientQueryFromSearchParams(Object.fromEntries(clientQueryToSearchParams(q)))).toEqual(q);
  });

  it("CPF/CNPJ (qualquer busca com dígitos) NUNCA vai para a URL", () => {
    const params = clientQueryToSearchParams({ ...DEFAULT_CLIENT_QUERY, search: "999.000.001" });
    expect(params.has("busca")).toBe(false);
    expect(params.toString()).not.toMatch(/\d{3}/);
    // E uma URL forjada com dígitos não vira busca.
    expect(clientQueryFromSearchParams({ busca: "99900000191" }).search).toBe("");
  });

  it("padrão não polui a URL; valores inválidos voltam ao padrão", () => {
    expect(clientQueryToSearchParams(DEFAULT_CLIENT_QUERY).toString()).toBe("");
    expect(clientQueryFromSearchParams({ pagina: "-4", tipo: "xx", ordem: "drop table", responsavel: "abc", origem: "1; select" })).toEqual(DEFAULT_CLIENT_QUERY);
  });

  it("entrada da action: situação → status do banco; vazio → ausente", () => {
    expect(clientQueryToInput({ ...DEFAULT_CLIENT_QUERY, lifecycle: "active" })).toMatchObject({ status: "ACTIVE", page: 1, pageSize: 25, q: undefined, kind: undefined });
    expect(clientQueryToInput({ ...DEFAULT_CLIENT_QUERY, lifecycle: "inactive", search: " 999 " })).toMatchObject({ status: "INACTIVE", q: "999" });
    expect(clientQueryToInput(DEFAULT_CLIENT_QUERY).status).toBeUndefined();
  });

  it("filtros ativos", () => {
    expect(hasClientFilters(DEFAULT_CLIENT_QUERY)).toBe(false);
    expect(hasClientFilters({ ...DEFAULT_CLIENT_QUERY, page: 4, sort: "name" })).toBe(false);
    expect(hasClientFilters({ ...DEFAULT_CLIENT_QUERY, kind: "INDIVIDUAL" })).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Formulário → entrada das actions (validada pelo schema REAL)         */
/* ------------------------------------------------------------------ */

function pf(overrides: Partial<ReturnType<typeof emptyIndividualValues>> = {}) {
  return { ...emptyIndividualValues(USER, ORG), fullName: "Maria Teste", cpf: "999.000.001-91", phone: "(11) 99999-0000", ...overrides };
}

describe("cadastro de cliente — formulário → createClientAction", () => {
  it("PF mínima passa no schema do servidor; vazios com formato viram ausentes", () => {
    const parsed = createClientSchema.safeParse(individualCreateInput(pf()));
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.kind !== "INDIVIDUAL") return;
    expect(parsed.data.cpf).toBe("99900000191");
    expect(parsed.data.birthDate).toBeUndefined();
    expect(parsed.data.address).toBeUndefined();
    expect(parsed.data.originOfficeId).toBe(ORG);
  });

  it("endereço: 'Brasil' vira BR, UF em maiúsculas, CEP só dígitos", () => {
    const parsed = createClientSchema.parse(
      individualCreateInput(pf({ address: { zipCode: "01001-000", street: "Praça da Sé", number: "1", complement: "", district: "Sé", city: "São Paulo", state: "sp", country: "Brasil" } })),
    );
    expect(parsed.address).toMatchObject({ zipCode: "01001000", state: "SP", country: "BR" });
  });

  it("PJ com representante e sócio passa no schema do servidor", () => {
    const v = emptyCompanyValues(USER, ORG);
    const values = {
      ...v,
      legalName: "Empresa Teste Ltda",
      cnpj: "99.000.000/0001-91",
      phone: "(11) 3333-0000",
      mainCnae: "6911-7/01",
      secondaryCnaes: "6911-7/02\n6920-6/01",
      representatives: [{ ...v.representatives[0], name: "Rep Teste", cpf: "999.000.002-72", role: "Sócio" }],
      partners: [{ id: "x", name: "Sócio Teste", document: "", qualification: "", sharePercent: "50,5" }],
    };
    const parsed = createClientSchema.safeParse(companyCreateInput(values));
    expect(parsed.success).toBe(true);
    if (!parsed.success || parsed.data.kind !== "COMPANY") return;
    expect(parsed.data.mainCnae).toBe("6911701");
    expect(parsed.data.secondaryCnaes).toEqual(["6911702", "6920601"]);
    expect(parsed.data.partners[0].sharePercent).toBe(50.5);
    // Nenhum id gerado no navegador vai para o servidor.
    expect(JSON.stringify(companyCreateInput(values))).not.toContain('"id"');
  });

  it("país: nome ou código; vazio = Brasil; o formulário mostra o nome", () => {
    expect([countryCode(""), countryCode("brasil"), countryCode("pt"), countryCode("Portugal")]).toEqual(["BR", "BR", "PT", undefined]);
    expect(fromAddress({ zipCode: "", street: "", number: "", district: "", city: "", state: "", country: "BR" }).country).toBe("Brasil");
  });
});

describe("edição de cliente — PATCH", () => {
  const original = { id: "c1", kind: "INDIVIDUAL", cpf: "99900000191" } as unknown as Client;

  it("documento só vai quando muda (corrigir CPF é decisão de ADMIN)", () => {
    expect(individualPatch(pf(), original)).not.toHaveProperty("document");
    expect(individualPatch(pf({ cpf: "999.000.003-53" }), original).document).toBe("999.000.003-53");
  });

  it("apagar texto e contato: chave presente, o servidor grava null", () => {
    const parsed = updateClientSchema.parse({ id: "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a", patch: individualPatch(pf({ socialName: "", phone: "" }), original) });
    expect("socialName" in parsed.patch).toBe(true);
    expect(parsed.patch.socialName).toBeUndefined();
    expect(parsed.patch.contact).toHaveProperty("phone", undefined);
    expect(parsed.patch.address).toBeNull();
  });

  it("PJ: representantes e sócios não vão no PATCH", () => {
    const company = { id: "c2", kind: "COMPANY", cnpj: "99000000000191" } as unknown as Client;
    const patch = companyPatch({ ...emptyCompanyValues(USER, ORG), legalName: "X", cnpj: "99.000.000/0001-91" }, company);
    expect(patch).not.toHaveProperty("representatives");
    expect(patch).not.toHaveProperty("partners");
    expect(patch).not.toHaveProperty("document");
  });
});

/* ------------------------------------------------------------------ */
/* Bloco societário de PJ (028)                                        */
/* ------------------------------------------------------------------ */

describe("representantes e sócios — estado final para replaceCompanyPeopleAction", () => {
  const REP_ID = "2c9e6f1a-7b3d-4e5f-8a9b-1c2d3e4f5a6b";
  const SH_ID = "3d0f7a2b-8c4e-4f60-9b1c-2d3e4f5a6b7c";
  const values = {
    representatives: [
      { id: REP_ID, name: "Rep Existente", cpf: "999.000.002-72", role: "Diretor", email: "", phone: "", isPrimary: false },
      { ...newRepresentative(true), name: "Rep Novo", cpf: "999.000.004-34", role: "Procurador" },
    ],
    partners: [{ id: SH_ID, name: "Sócio Existente", document: "", qualification: "", sharePercent: "40" }, { ...newPartner(), name: "Sócio Novo" }, newPartner()],
  };

  it("item novo vai SEM id (nada gerado no navegador); existente leva o id do banco", () => {
    const input = companyPeopleInput(ORG, values) as { representatives: { id?: string }[]; partners: { id?: string }[] };
    expect(input.representatives.map((r) => r.id)).toEqual([REP_ID, undefined]);
    // Linha de sócio em branco é ignorada.
    expect(input.partners.map((p) => p.id)).toEqual([SH_ID, undefined]);
    // O formulário (Front V1) exige nome em cada sócio: linha em branco é apontada antes do envio.
    expect(companyPeopleSchema.safeParse(values).success).toBe(false);
    expect(companyPeopleSchema.safeParse({ ...values, partners: values.partners.slice(0, 2) }).success).toBe(true);
  });

  it("passa no schema do servidor e vira o payload do banco", () => {
    const parsed = replaceCompanyPeopleSchema.parse(companyPeopleInput(ORG, values));
    const payload = companyPeoplePayload(parsed);
    expect(payload.representatives).toEqual([
      { id: REP_ID, name: "Rep Existente", cpf: "99900000272", role: "Diretor", email: null, phone: null, is_primary: false },
      { name: "Rep Novo", cpf: "99900000434", role: "Procurador", email: null, phone: null, is_primary: true },
    ]);
    expect(payload.shareholders[0]).toMatchObject({ id: SH_ID, share_percentage: 40 });
    expect(payload.shareholders[1]).not.toHaveProperty("id");
  });

  it("servidor recusa dois principais, id que não é UUID e lista acima do limite", () => {
    const two = companyPeopleInput(ORG, { ...values, representatives: values.representatives.map((r) => ({ ...r, isPrimary: true })) });
    expect(replaceCompanyPeopleSchema.safeParse(two).success).toBe(false);
    expect(replaceCompanyPeopleSchema.safeParse({ clientId: ORG, representatives: [{ id: "rep_123", name: "X", isPrimary: true }], partners: [] }).success).toBe(false);
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `S${i}` }));
    expect(replaceCompanyPeopleSchema.safeParse({ clientId: ORG, representatives: [], partners: many }).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Erros                                                               */
/* ------------------------------------------------------------------ */

describe("erros das actions na UI", () => {
  it("erros de campo do servidor vão para os nomes do formulário", () => {
    expect(
      mapFieldErrors(
        { "patch.contact.email": ["E-mail inválido."], "patch.identityDocument.number": ["Campo obrigatório."], "patch.fullName": ["Informe."] },
        CLIENT_FIELD_MAP,
        "patch.",
      ),
    ).toEqual({ email: "E-mail inválido.", idNumber: "Campo obrigatório.", fullName: "Informe." });
  });

  it("falha de rede vira erro recuperável, sem detalhe técnico", async () => {
    const r = await callAction(() => Promise.reject(new TypeError("fetch failed at 10.0.0.1")));
    expect(r).toEqual({ ok: false, error: { code: "INTERNAL", message: NETWORK_ERROR_MESSAGE }, requestId: "" });
  });

  it("código de referência curto a partir do requestId", () => {
    expect(referenceCode("3f2a9c1d-0000-4000-8000-000000000000")).toBe("3F2A9C1D");
    expect(referenceCode("")).toBeUndefined();
  });
});
