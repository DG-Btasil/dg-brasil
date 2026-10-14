import { describe, expect, it } from "vitest";
import { stableStringify } from "@/lib/hooks/use-idempotency-key";
import { listCasesSchema, updateCaseSchema } from "@/server/domain/cases/schemas";
import { orQuoted, likePattern } from "@/server/domain/cases/repository";
import { listItemFromRow, localDate, type ProcessRow } from "@/server/domain/processes/mappers";
import { createProcessSchema, listProcessesSchema, updateProcessSchema } from "@/server/domain/processes/schemas";
import { caseQueryFromSearchParams, caseQueryToInput, caseQueryToSearchParams, DEFAULT_CASE_QUERY, type CaseListQuery } from "@/features/cases/list-query";
import { DEFAULT_PROCESS_QUERY, processQueryFromSearchParams, processQueryToInput, processQueryToSearchParams, type ProcessListQuery } from "./list-query";
import { processCreateInput, processEditPatch } from "./server-input";
import type { ProcessFormValues } from "./schemas";

const UUID_A = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const UUID_B = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

/* ------------------------------------------------------------------ */
/* Idempotência: a "intenção" não depende da ordem das propriedades     */
/* ------------------------------------------------------------------ */

describe("chave de idempotência por intenção (impressão digital)", () => {
  it("mesma intenção com propriedades em outra ordem → mesma impressão", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: "x" } })).toBe(stableStringify({ a: { c: "x", d: [1, 2] }, b: 1 }));
  });
  it("undefined não conta; ordem de array e valores contam", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: [1, 2] })).not.toBe(stableStringify({ a: [2, 1] }));
    expect(stableStringify({ title: "Caso A" })).not.toBe(stableStringify({ title: "Caso B" }));
  });
});

/* ------------------------------------------------------------------ */
/* Lista de casos                                                      */
/* ------------------------------------------------------------------ */

describe("lista de casos — URL e entrada da action", () => {
  it("ida e volta pela URL", () => {
    const q: CaseListQuery = { search: "Revisional", status: "ACCEPTED", area: "BANKING", lawyer: UUID_A, origin: UUID_B, clientId: UUID_A, period: "30", sort: "title", direction: "asc", page: 2 };
    expect(caseQueryFromSearchParams(Object.fromEntries(caseQueryToSearchParams(q)))).toEqual(q);
  });
  it("busca com dígitos não vai para a URL; valores inválidos voltam ao padrão", () => {
    expect(caseQueryToSearchParams({ ...DEFAULT_CASE_QUERY, search: "999.000" }).has("busca")).toBe(false);
    expect(caseQueryFromSearchParams({ situacao: "X", area: "drop", responsavel: "1;", periodo: "365", pagina: "0" })).toEqual(DEFAULT_CASE_QUERY);
  });
  it("entrada passa no schema REAL do servidor; período vira data inicial", () => {
    const input = caseQueryToInput({ ...DEFAULT_CASE_QUERY, status: "SUBMITTED", area: "BANKING", period: "7" }, new Date("2026-10-13T12:00:00Z"));
    expect(input.createdFrom).toBe("2026-10-06");
    const parsed = listCasesSchema.parse(input);
    expect(parsed).toMatchObject({ status: ["SUBMITTED"], area: "BANKING", createdFrom: "2026-10-06", pageSize: 25 });
  });
});

/* ------------------------------------------------------------------ */
/* Lista de processos                                                  */
/* ------------------------------------------------------------------ */

describe("lista de processos — URL e entrada da action", () => {
  it("ida e volta pela URL", () => {
    const q: ProcessListQuery = { search: "Revisional", status: "ACTIVE", phase: "EVIDENCE", court: "TJSP", responsible: UUID_A, clientId: UUID_B, origin: "MANUAL", caseOrigin: UUID_A, deadline: "OVERDUE", sort: "cnj", direction: "asc", page: 3 };
    expect(processQueryFromSearchParams(Object.fromEntries(processQueryToSearchParams(q)))).toEqual(q);
  });
  it("CNJ/CPF digitado não vai para a URL; tribunal fora da lista é ignorado", () => {
    expect(processQueryToSearchParams({ ...DEFAULT_PROCESS_QUERY, search: "0001234-03" }).has("busca")).toBe(false);
    expect(processQueryFromSearchParams({ tribunal: "XYZ" }).court).toBe("");
  });
  it("entrada passa no schema REAL do servidor", () => {
    const parsed = listProcessesSchema.parse(processQueryToInput({ ...DEFAULT_PROCESS_QUERY, phase: "EVIDENCE", court: "TJSP", origin: "INTEGRATION", caseOrigin: UUID_A }));
    expect(parsed).toMatchObject({ phase: "EVIDENCE", court: "TJSP", technicalOrigin: "INTEGRATION", caseOriginOrganizationId: UUID_A });
  });
});

/* ------------------------------------------------------------------ */
/* Formulário de processo → actions                                    */
/* ------------------------------------------------------------------ */

const formValues = (o: Partial<ProcessFormValues> = {}): ProcessFormValues => ({
  legalCaseId: UUID_A,
  cnj: "",
  title: "Revisional",
  court: "TJSP",
  unit: "",
  district: "",
  state: "SP",
  actionType: "Ação revisional",
  subject: "",
  clientPole: "ACTIVE",
  opposingParty: "Banco X",
  responsibleUserId: UUID_B,
  distributionDate: "",
  caseValue: "12.345,67",
  status: "PRE_FILING",
  phase: "PRELIMINARY",
  deadlineTitle: "",
  deadlineType: "",
  deadlineDueDate: "2026-12-15",
  notes: "",
  ...o,
});

describe("processo — formulário → schema real", () => {
  it("cadastro: campos vazios ausentes, valor em reais, prazo inicial com padrão", () => {
    const parsed = createProcessSchema.parse({ ...processCreateInput(formValues()), idempotencyKey: UUID_B });
    expect(parsed.cnj).toBeUndefined();
    expect(parsed.distributionDate).toBeUndefined();
    expect(parsed.caseValue).toBe(12345.67);
    expect(parsed.nextDeadline).toEqual({ title: "Acompanhamento do processo", type: "INTERNAL", dueDate: "2026-12-15" });
  });
  it("cadastro com CNJ inválido (dígito verificador) é recusado pelo servidor", () => {
    expect(createProcessSchema.safeParse({ ...processCreateInput(formValues({ cnj: "0001234-00.2026.8.26.0100" })), idempotencyKey: UUID_B }).success).toBe(false);
  });
  it("edição: vazio limpa (null) nos campos com formato; texto vazio também apaga", () => {
    const { patch } = updateProcessSchema.parse({ id: UUID_A, patch: processEditPatch(formValues({ state: "", caseValue: "", unit: "" })) });
    expect(patch.state).toBeNull();
    expect(patch.cnj).toBeNull();
    expect(patch.distributionDate).toBeNull();
    expect(patch.caseValue).toBeNull();
    expect("unit" in patch).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Servidor: mapeamentos novos                                          */
/* ------------------------------------------------------------------ */

describe("servidor — partes puras da Fase B", () => {
  it("processo na lista traz cliente, caso e origem do caso a partir do embed", () => {
    const row = {
      id: UUID_A,
      legal_case_id: UUID_B,
      title: "P",
      cnj_number: null,
      technical_origin: "MANUAL",
      court: null,
      court_unit: null,
      district: null,
      state: null,
      legal_class: "Revisional",
      subject: null,
      client_side: null,
      adverse_party_summary: null,
      currency: "BRL",
      status: "ACTIVE",
      phase: null,
      distribution_date: null,
      created_at: "2026-10-01T00:00:00Z",
      updated_at: "2026-10-01T00:00:00Z",
      legal_cases: { client_id: "c1", title: "Caso X", origin_organization_id: "o1", partner_organization_id: null, clients: { individual_client_details: [{ full_name: "Maria" }], company_client_details: null } },
    } as unknown as ProcessRow;
    expect(listItemFromRow(row, { surface: "PARTNER", canViewCaseValue: false })).toMatchObject({
      clientId: "c1",
      clientName: "Maria",
      caseTitle: "Caso X",
      caseOriginOrganizationId: "o1",
      actionType: "Revisional",
      origin: "MANUAL",
      responsibleUserId: undefined,
    });
  });
  it("vencimento exibido na data de Brasília (23:59 de lá não vira o dia seguinte)", () => {
    expect(localDate("2026-12-16T02:59:59Z")).toBe("2026-12-15");
  });
  it("busca de casos: curinga escapado e valor entre aspas no filtro or=()", () => {
    expect(orQuoted(likePattern('a,b)"x'))).toBe('"%a,b)\\"x%"');
    expect(orQuoted(likePattern("50%"))).toBe('"%50\\\\%%"');
  });
  it("edição de caso: tipo pode ser removido (null); área por código", () => {
    expect(updateCaseSchema.parse({ id: UUID_A, patch: { caseTypeId: null, area: "consumer" } }).patch).toEqual({ caseTypeId: null, area: "CONSUMER" });
  });
});
