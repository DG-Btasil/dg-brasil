import { describe, expect, it } from "vitest";
import { listCasesSchema, partnerSubmitCaseSchema } from "@/server/domain/cases/schemas";
import { createPartnerProcessSchema } from "@/server/domain/processes/schemas";
import { DEFAULT_PORTAL_QUERY, PARTNER_STATUS_GROUPS, portalCaseInput, portalClientInput, portalQueryFromSearchParams, portalQueryToSearchParams } from "./list-query";
import { partnerOrigin, partnerProcessInput, partnerSubmitInput, type PartnerCaseValues, type PartnerProcessValues } from "./server-input";

const OWNER = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const PARTNER = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const CASE = "2c3d4e5f-6071-4829-9b0c-1d2e3f4a5b6c";
const KEY = "3d4e5f60-7182-4930-8c1d-2e3f4a5b6c7d";

const caseValues: PartnerCaseValues = {
  kind: "INDIVIDUAL",
  clientOriginId: PARTNER,
  document: "999.000.001-91",
  fullName: "  Maria Teste  ",
  birthDate: "1960-05-10",
  legalName: "",
  tradeName: "",
  email: "maria@dgbrasil.test",
  phone: "(11) 99999-0000",
  zipCode: "01001-000",
  street: "Rua A",
  number: "10",
  complement: "",
  district: "Centro",
  city: "São Paulo",
  state: "SP",
  title: " Descontos não reconhecidos ",
  area: "BANKING",
  caseTypeId: "",
  caseOriginId: OWNER,
  opposingParty: "",
  summary: "Relato do caso.",
  notes: "",
};

/* ------------------------------------------------------------------ */
/* Listas do portal: URL sem CPF/CNPJ e escritório nunca do navegador  */
/* ------------------------------------------------------------------ */

describe("listas do portal — URL e entrada das actions", () => {
  it("ida e volta pela URL (casos, com situação simplificada)", () => {
    const q = { search: "Revisional", status: "Em análise", page: 3 };
    expect(portalQueryFromSearchParams(Object.fromEntries(portalQueryToSearchParams(q)), true)).toEqual(q);
  });
  it("busca com dígitos (CPF/CNPJ) nunca vai para a URL nem volta dela", () => {
    expect(portalQueryToSearchParams({ ...DEFAULT_PORTAL_QUERY, search: "999.000.001" }).has("busca")).toBe(false);
    expect(portalQueryFromSearchParams({ busca: "99900000191" }).search).toBe("");
  });
  it("situação desconhecida ou fora de casos é ignorada; página inválida volta a 1", () => {
    expect(portalQueryFromSearchParams({ situacao: "Qualquer", pagina: "-2" }, true)).toEqual(DEFAULT_PORTAL_QUERY);
    expect(portalQueryFromSearchParams({ situacao: "Aceito" }).status).toBe("");
  });
  it("rótulo do parceiro agrupa as situações reais (Em análise = 3 situações)", () => {
    expect(PARTNER_STATUS_GROUPS.find((g) => g.label === "Em análise")?.statuses).toEqual(["READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"]);
    const input = portalCaseInput({ search: "", status: "Em análise", page: 1 });
    expect(listCasesSchema.parse(input).status).toEqual(["READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"]);
  });
  it("entrada nunca leva escritório, responsável ou origem (RLS recorta ao parceiro)", () => {
    const input = portalClientInput({ search: "Maria", status: "", page: 2 });
    expect(input).toEqual({ q: "Maria", page: 2, pageSize: 25, sortBy: "updatedAt", sortDirection: "desc" });
    for (const k of ["partnerOrganizationId", "originOrganizationId", "responsibleUserId", "organizationId"]) expect(k in input).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Envio de caso pelo parceiro                                          */
/* ------------------------------------------------------------------ */

describe("envio de caso do parceiro — entrada de partnerSubmitCaseAction", () => {
  it("origem: id do proprietário → OWNER; próprio escritório → OWN_OFFICE (o id nunca vai)", () => {
    expect(partnerOrigin(OWNER, OWNER)).toBe("OWNER");
    expect(partnerOrigin(PARTNER, OWNER)).toBe("OWN_OFFICE");
    expect(partnerOrigin("", OWNER)).toBe("OWN_OFFICE");
  });
  it("cliente NOVO leva o cadastro básico e passa no schema do servidor", () => {
    const payload = partnerSubmitInput(caseValues, OWNER, false);
    const parsed = partnerSubmitCaseSchema.parse({ ...payload, idempotencyKey: KEY });
    expect(parsed.client).toMatchObject({ kind: "INDIVIDUAL", document: "99900000191", fullName: "Maria Teste", origin: "OWN_OFFICE" });
    expect(parsed.case).toMatchObject({ area: "BANKING", title: "Descontos não reconhecidos", origin: "OWNER" });
    expect(JSON.stringify(payload)).not.toContain(PARTNER);
    expect(JSON.stringify(payload)).not.toContain(OWNER);
  });
  it("cliente EXISTENTE leva só tipo + documento + origem (nunca sobrescreve o cadastro canônico)", () => {
    const payload = partnerSubmitInput(caseValues, OWNER, true) as { client: Record<string, unknown> };
    expect(Object.keys(payload.client).sort()).toEqual(["document", "kind", "origin"]);
    expect(partnerSubmitCaseSchema.safeParse({ ...payload, idempotencyKey: KEY }).success).toBe(true);
  });
  it("PJ: razão social e nome fantasia; sem campos de PF", () => {
    const payload = partnerSubmitInput({ ...caseValues, kind: "COMPANY", document: "99.000.000/0001-91", legalName: "Empresa Teste", tradeName: "ET" }, OWNER, false) as {
      client: Record<string, unknown>;
    };
    expect(payload.client).toMatchObject({ kind: "COMPANY", legalName: "Empresa Teste", tradeName: "ET" });
    expect("fullName" in payload.client).toBe(false);
  });
  it("sem chave de idempotência o servidor recusa", () => {
    expect(partnerSubmitCaseSchema.safeParse(partnerSubmitInput(caseValues, OWNER, false)).success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Processo cadastrado pelo parceiro                                    */
/* ------------------------------------------------------------------ */

describe("processo do parceiro — entrada de createPartnerProcessAction", () => {
  const values: PartnerProcessValues = {
    cnj: "",
    title: " Revisional ",
    court: "",
    unit: "",
    district: "",
    state: "",
    actionType: "Procedimento comum",
    subject: "",
    clientPole: "ACTIVE",
    opposingParty: "",
    distributionDate: "",
    caseValue: "R$ 1.234,56",
  };
  it("vazio vira ausente; valor da causa em número; passa no schema do servidor", () => {
    const input = partnerProcessInput(CASE, values);
    expect(input).toMatchObject({ legalCaseId: CASE, title: "Revisional", cnj: undefined, state: undefined, caseValue: 1234.56 });
    expect(createPartnerProcessSchema.safeParse({ ...input, idempotencyKey: KEY }).success).toBe(true);
  });
  it("campos internos (responsável, status, notas) nunca saem do portal", () => {
    const input = partnerProcessInput(CASE, values);
    for (const k of ["responsibleUserId", "status", "phase", "notes", "summary", "operationalDueAt"]) expect(k in input).toBe(false);
  });
});
