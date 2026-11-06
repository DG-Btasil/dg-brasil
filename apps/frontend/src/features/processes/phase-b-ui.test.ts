import { describe, expect, it } from "vitest";
import { processHeading, processSubtitle } from "./subtitle";
import { stableStringify } from "@/lib/hooks/use-idempotency-key";
import { listCasesSchema, updateCaseSchema } from "@/server/domain/cases/schemas";
import { orQuoted, likePattern } from "@/server/domain/cases/repository";
import { listItemFromRow, localDate, type ProcessRow } from "@/server/domain/processes/mappers";
import { createProcessSchema, listProcessesSchema, updateProcessSchema } from "@/server/domain/processes/schemas";
import { caseQueryFromSearchParams, caseQueryToInput, caseQueryToSearchParams, DEFAULT_CASE_QUERY, type CaseListQuery } from "@/features/cases/list-query";
import { DEFAULT_PROCESS_QUERY, processQueryFromSearchParams, processQueryToInput, processQueryToSearchParams, type ProcessListQuery } from "./list-query";
import { processCreateInput, processEditPatch } from "./server-input";
import { parsePercentInput, processFormSchema, type ProcessFormValues } from "./schemas";

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
    const q: ProcessListQuery = { search: "Revisional", status: "SENTENCED", phase: "PROCEEDINGS", court: "TJSP", responsible: UUID_A, clientId: UUID_B, origin: "MANUAL", caseOrigin: UUID_A, deadline: "OVERDUE", sort: "cnj", direction: "asc", page: 3 };
    expect(processQueryFromSearchParams(Object.fromEntries(processQueryToSearchParams(q)))).toEqual(q);
  });
  it("CNJ/CPF digitado não vai para a URL; tribunal fora da lista é ignorado", () => {
    expect(processQueryToSearchParams({ ...DEFAULT_PROCESS_QUERY, search: "0001234-03" }).has("busca")).toBe(false);
    expect(processQueryFromSearchParams({ tribunal: "XYZ" }).court).toBe("");
  });
  it("entrada passa no schema REAL do servidor", () => {
    const parsed = listProcessesSchema.parse(processQueryToInput({ ...DEFAULT_PROCESS_QUERY, phase: "PROCEEDINGS", court: "TJSP", origin: "INTEGRATION", caseOrigin: UUID_A }));
    expect(parsed).toMatchObject({ phase: "PROCEEDINGS", court: "TJSP", technicalOrigin: "INTEGRATION", caseOriginOrganizationId: UUID_A });
  });
  it("status e fases da 045 na URL; valores antigos caem no padrão (sem filtro)", () => {
    for (const status of ["RECEIVED", "ARCHIVED", "FINAL_JUDGMENT"] as const) expect(processQueryFromSearchParams({ status }).status).toBe(status);
    expect(processQueryFromSearchParams({ status: "CLOSED", fase: "EVIDENCE" })).toMatchObject({ status: "", phase: "" });
  });
});

/* ------------------------------------------------------------------ */
/* Formulário de processo → actions                                    */
/* ------------------------------------------------------------------ */

const formValues = (o: Partial<ProcessFormValues> = {}): ProcessFormValues => ({
  legalCaseId: UUID_A,
  cnj: "",
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
  feeAmount: "",
  feePercentage: "",
  status: "PRE_FILING",
  phase: "PRELIMINARY",
  notes: "",
  ...o,
});

describe("processo — formulário → schema real", () => {
  it("cadastro: campos vazios ausentes, valor em reais, sem nome próprio nem prazo inicial", () => {
    const input = processCreateInput(formValues());
    expect("title" in input).toBe(false);
    expect("nextDeadline" in input).toBe(false);
    const parsed = createProcessSchema.parse({ ...input, idempotencyKey: UUID_B });
    expect(parsed.cnj).toBeUndefined();
    expect(parsed.distributionDate).toBeUndefined();
    expect(parsed.caseValue).toBe(12345.67);
    expect(parsed.title).toBeUndefined();
    expect(parsed.nextDeadline).toBeUndefined();
    expect(parsed.feeAmount).toBeUndefined();
    expect(parsed.feePercentage).toBeUndefined();
  });
  it("cadastro: honorários em reais e de êxito em %", () => {
    const parsed = createProcessSchema.parse({ ...processCreateInput(formValues({ feeAmount: "R$ 5.000,00", feePercentage: "12,5" })), idempotencyKey: UUID_B });
    expect(parsed).toMatchObject({ feeAmount: 5000, feePercentage: 12.5 });
  });
  it("honorários de êxito: só 0–100 (formulário e servidor)", () => {
    expect(processFormSchema.safeParse(formValues({ feePercentage: "101" })).success).toBe(false);
    expect(processFormSchema.safeParse(formValues({ feePercentage: "abc" })).success).toBe(false);
    expect(processFormSchema.safeParse(formValues({ feePercentage: "30%" })).success).toBe(true);
    expect(createProcessSchema.safeParse({ ...processCreateInput(formValues()), feePercentage: 150, idempotencyKey: UUID_B }).success).toBe(false);
    expect(parsePercentInput("")).toBeUndefined();
    expect(parsePercentInput(" 7,25 % ")).toBe(7.25);
  });
  it("cadastro com CNJ inválido (dígito verificador) é recusado pelo servidor", () => {
    expect(createProcessSchema.safeParse({ ...processCreateInput(formValues({ cnj: "0001234-00.2026.8.26.0100" })), idempotencyKey: UUID_B }).success).toBe(false);
  });
  it("edição: vazio limpa (null) nos campos com formato; texto vazio também apaga; título não é enviado", () => {
    const { patch } = updateProcessSchema.parse({ id: UUID_A, patch: processEditPatch(formValues({ state: "", caseValue: "", unit: "" })) });
    expect(patch.state).toBeNull();
    expect(patch.cnj).toBeNull();
    expect(patch.distributionDate).toBeNull();
    expect(patch.caseValue).toBeNull();
    expect(patch.feeAmount).toBeNull();
    expect(patch.feePercentage).toBeNull();
    expect("unit" in patch).toBe(true);
    expect("title" in patch).toBe(false);
  });
  it("edição: honorários gravados nos dados internos", () => {
    const { patch } = updateProcessSchema.parse({ id: UUID_A, patch: processEditPatch(formValues({ feeAmount: "1.500,00", feePercentage: "20" })) });
    expect(patch).toMatchObject({ feeAmount: 1500, feePercentage: 20 });
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
    // Sem título próprio (processo novo), o nome exibido é o do caso — nunca vazio.
    expect(listItemFromRow({ ...row, title: null }, { surface: "INTERNAL", canViewCaseValue: false }).title).toBe("Caso X");
    expect(listItemFromRow({ ...row, title: "  ", legal_cases: { client_id: "c1", title: "" } }, { surface: "INTERNAL", canViewCaseValue: false }).title).toBe("Processo sem título");
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

describe("lista de processos — coluna Tipo / ação (QA 4.3, BUG-02)", () => {
  it("o caso aparece sempre; com tipo de ação, depois do título do processo", () => {
    expect(processSubtitle({ actionType: "Ação revisional", title: "Proc 1", caseTitle: "Caso X" })).toBe("Proc 1 · Caso X");
    expect(processSubtitle({ actionType: undefined, title: "Proc 1", caseTitle: "Caso X" })).toBe("Caso X");
    expect(processSubtitle({ actionType: "Ação", title: "Caso X", caseTitle: "Caso X" })).toBe("Caso X");
    expect(processSubtitle({ actionType: "Ação", title: "Proc 1", caseTitle: "" })).toBe("Proc 1");
  });
  it("processo sem título próprio (nome = caso) e sem tipo de ação: o caso fica na 1ª linha, sem repetir", () => {
    const p = { actionType: undefined, title: "Caso X", caseTitle: "Caso X" };
    expect(processHeading(p)).toBe("Caso X");
    expect(processSubtitle(p)).toBe("");
    expect(processHeading({ actionType: "Ação revisional", title: "Caso X", caseTitle: "Caso X" })).toBe("Ação revisional");
  });
});
