import { describe, expect, it } from "vitest";
import {
  eventFromRow,
  internalDetailsPatch,
  internalDetailsRow,
  internalProcessFromRows,
  listItemFromRow,
  manualEventRow,
  partnerProcessFromRow,
  partyFromRow,
  partyInsertRow,
  partyUpdatePatch,
  processInsertRow,
  processUpdatePatch,
  type ProcessRow,
} from "./mappers";
import { likePattern, processColumns, searchTarget } from "./repository";
import {
  addPartySchema,
  createEventSchema,
  createPartnerProcessSchema,
  createProcessSchema,
  listProcessesSchema,
  updatePartySchema,
  updateProcessSchema,
} from "./schemas";

const CASE = "00000000-0000-4000-8000-0000000000c1";
const CLIENT = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const PROC = "00000000-0000-4000-8000-0000000000d1";
const CNJ = "00012340320268260100";

const row = (over: Partial<ProcessRow> = {}): ProcessRow => ({
  id: PROC,
  legal_case_id: CASE,
  title: "Revisional consignado",
  cnj_number: CNJ,
  technical_origin: "MANUAL",
  court: "TJSP",
  court_unit: "1ª Vara Cível",
  district: "São Paulo",
  state: "SP",
  legal_class: "Procedimento Comum Cível",
  subject: "Empréstimo consignado",
  client_side: "ACTIVE",
  adverse_party_summary: "Banco Fictício S.A.",
  case_value: "15000.50",
  currency: "BRL",
  status: "ACTIVE",
  phase: "PLEADINGS",
  distribution_date: "2026-09-01",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
  legal_cases: { client_id: CLIENT },
  responsible_user_id: USER,
  operational_due_at: "2026-11-01T12:00:00Z",
  created_by: USER,
  ...over,
});

describe("schemas — CNJ e cadastro", () => {
  it("CNJ com máscara vira 20 dígitos; tamanho errado é recusado; vazio é ausente", () => {
    const ok = createProcessSchema.parse({ legalCaseId: CASE, title: "P", cnj: "0001234-03.2026.8.26.0100" });
    expect(ok.cnj).toBe(CNJ);
    expect(createProcessSchema.safeParse({ legalCaseId: CASE, title: "P", cnj: "1234-56.2026" }).success).toBe(false);
    expect(createProcessSchema.safeParse({ legalCaseId: CASE, title: "P", cnj: "000123403202682601000" }).success).toBe(false);
    expect(createProcessSchema.parse({ legalCaseId: CASE, title: "P", cnj: "  " }).cnj).toBeUndefined();
  });

  it("processo sem caso não passa (nunca órfão)", () => {
    expect(createProcessSchema.safeParse({ title: "P" }).success).toBe(false);
    expect(createPartnerProcessSchema.safeParse({ title: "P", legalCaseId: "x" }).success).toBe(false);
  });

  it("valor da causa: não negativo e no máximo 2 casas", () => {
    expect(createProcessSchema.safeParse({ legalCaseId: CASE, title: "P", caseValue: -1 }).success).toBe(false);
    expect(createProcessSchema.safeParse({ legalCaseId: CASE, title: "P", caseValue: 10.123 }).success).toBe(false);
    expect(createProcessSchema.parse({ legalCaseId: CASE, title: "P", caseValue: 10.12 }).caseValue).toBe(10.12);
  });

  it("parceiro não informa campo interno: status, responsável e notas são descartados", () => {
    const parsed = createPartnerProcessSchema.parse({ legalCaseId: CASE, title: "P", status: "CLOSED", responsibleUserId: USER, notes: "x", summary: "y" });
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("responsibleUserId");
    expect(parsed).not.toHaveProperty("notes");
    expect(parsed).not.toHaveProperty("summary");
  });

  it("edição: patch vazio é recusado; CNJ vazio limpa (null)", () => {
    expect(updateProcessSchema.safeParse({ id: PROC, patch: {} }).success).toBe(false);
    expect(updateProcessSchema.parse({ id: PROC, patch: { cnj: "" } }).patch.cnj).toBeNull();
    expect(updateProcessSchema.safeParse({ id: PROC, patch: { status: "OVERDUE" } }).success).toBe(false);
    expect(updateProcessSchema.parse({ id: PROC, patch: { status: "ARCHIVED" } }).patch.status).toBe("ARCHIVED");
  });

  it("listagem: ordenação só por whitelist; status do banco aceito", () => {
    const parsed = listProcessesSchema.parse({ sortBy: "cnj", sortDirection: "asc", status: "ARCHIVED" });
    expect(parsed).toMatchObject({ column: "cnj_number", ascending: true, status: "ARCHIVED", page: 1, pageSize: 25 });
    expect(listProcessesSchema.safeParse({ sortBy: "case_value" }).success).toBe(false);
    expect(listProcessesSchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });

  it("parte: CPF/CNPJ só dígitos; documento inválido recusado; vazio limpa na edição", () => {
    expect(addPartySchema.parse({ processId: PROC, type: "DEFENDANT", name: "Banco", document: "99.999.999/0001-99" }).document).toBe("99999999000199");
    expect(addPartySchema.safeParse({ processId: PROC, type: "DEFENDANT", name: "Banco", document: "123" }).success).toBe(false);
    expect(addPartySchema.safeParse({ processId: PROC, type: "JUDGE", name: "X" }).success).toBe(false);
    expect(updatePartySchema.parse({ id: PROC, patch: { document: "" } }).patch.document).toBeNull();
  });

  it("movimentação: não há campo de origem; tipo é código, não texto livre", () => {
    const parsed = createEventSchema.parse({ processId: PROC, title: "Contato com cliente", source: "JUDICIAL_INTEGRATION" });
    expect(parsed).not.toHaveProperty("source");
    expect(parsed.eventType).toBe("MANUAL_NOTE");
    expect(parsed.important).toBe(false);
    expect(createEventSchema.safeParse({ processId: PROC, title: "x", eventType: "drop table" }).success).toBe(false);
  });
});

describe("mapeamento banco → domínio", () => {
  it("ficha interna: dados processuais, responsável e dados internos", () => {
    const p = internalProcessFromRows(row(), { summary: "resumo interno", notes: "nota interna" }, true);
    expect(p).toMatchObject({
      id: PROC,
      legalCaseId: CASE,
      clientId: CLIENT,
      cnj: CNJ,
      unit: "1ª Vara Cível",
      actionType: "Procedimento Comum Cível",
      clientPole: "ACTIVE",
      opposingParty: "Banco Fictício S.A.",
      caseValue: 15000.5,
      origin: "MANUAL",
      responsibleUserId: USER,
      summary: "resumo interno",
      notes: "nota interna",
    });
  });

  it("ARCHIVED aparece como CLOSED (vocabulário do front), mantendo o status do banco", () => {
    const p = internalProcessFromRows(row({ status: "ARCHIVED" }), null, true);
    expect(p.status).toBe("CLOSED");
    expect(p.dbStatus).toBe("ARCHIVED");
  });

  it("ficha do parceiro não tem nenhum campo interno, mesmo se a linha trouxer", () => {
    const p = partnerProcessFromRow(row(), true);
    for (const field of ["responsibleUserId", "operationalDueAt", "createdBy", "summary", "notes"]) {
      expect(p).not.toHaveProperty(field);
    }
    expect(JSON.stringify(p)).not.toContain(USER);
    expect(p.clientId).toBe(CLIENT);
  });

  it("valor da causa some sem a permissão processes.caseValue.view", () => {
    expect(partnerProcessFromRow(row(), false).caseValue).toBeUndefined();
    expect(internalProcessFromRows(row(), null, false).caseValue).toBeUndefined();
    expect(listItemFromRow(row(), { surface: "INTERNAL", canViewCaseValue: false }).caseValue).toBeUndefined();
    expect(listItemFromRow(row(), { surface: "INTERNAL", canViewCaseValue: true }).caseValue).toBe(15000.5);
  });

  it("linha da listagem: responsável só para interno; cliente do caso (array ou objeto)", () => {
    expect(listItemFromRow(row(), { surface: "PARTNER", canViewCaseValue: true }).responsibleUserId).toBeUndefined();
    const item = listItemFromRow(row({ legal_cases: [{ client_id: CLIENT }] }), { surface: "INTERNAL", canViewCaseValue: true });
    expect(item).toMatchObject({ clientId: CLIENT, responsibleUserId: USER, status: "ACTIVE" });
  });

  it("parte e movimentação", () => {
    expect(
      partyFromRow({ id: "p1", legal_process_id: PROC, party_type: "DEFENDANT", name: "Banco", document_number: null, client_id: null, created_at: "2026-10-01T00:00:00Z" }),
    ).toEqual({ id: "p1", processId: PROC, type: "DEFENDANT", name: "Banco", document: undefined, clientId: undefined, createdAt: "2026-10-01T00:00:00Z" });
    const ev = {
      id: "e1",
      legal_process_id: PROC,
      event_type: "SENTENCE",
      title: null,
      description: "Sentença",
      occurred_at: "2026-10-01T00:00:00Z",
      source: "JUDICIAL_INTEGRATION" as const,
      important: true,
      created_at: "2026-10-01T00:00:00Z",
      external_provider: "DATAJUD",
    };
    expect(eventFromRow(ev, "INTERNAL").externalProvider).toBe("DATAJUD");
    expect(eventFromRow(ev, "PARTNER").externalProvider).toBeUndefined();
  });
});

describe("mapeamento domínio → banco", () => {
  it("cadastro interno: colunas do banco, origem MANUAL, sem chave vazia nem campo interno", () => {
    const input = createProcessSchema.parse({ legalCaseId: CASE, title: "P", cnj: CNJ, unit: "Vara", actionType: "Classe", clientPole: "PASSIVE", status: "FILED", summary: "s", notes: "n" });
    const out = processInsertRow(PROC, { ...input, responsibleUserId: USER }, "INTERNAL");
    expect(out).toEqual({
      id: PROC,
      legal_case_id: CASE,
      technical_origin: "MANUAL",
      title: "P",
      cnj_number: CNJ,
      court_unit: "Vara",
      legal_class: "Classe",
      client_side: "PASSIVE",
      status: "FILED",
      responsible_user_id: USER,
    });
    expect(internalDetailsRow(PROC, input)).toEqual({ legal_process_id: PROC, summary: "s", notes: "n" });
    expect(internalDetailsRow(PROC, {})).toBeNull();
  });

  it("cadastro do parceiro: lista fechada (status/responsável nunca vão ao banco)", () => {
    const sneaky = { legalCaseId: CASE, title: "P", status: "CLOSED", responsibleUserId: USER, operationalDueAt: "2026-01-01T00:00:00Z", technicalOrigin: "INTEGRATION" };
    const out = processInsertRow(PROC, sneaky as never, "PARTNER");
    expect(out).toEqual({ id: PROC, legal_case_id: CASE, technical_origin: "MANUAL", title: "P" });
  });

  it("edição: PATCH com só as chaves presentes; null limpa; notas vão para a tabela interna", () => {
    const { patch } = updateProcessSchema.parse({ id: PROC, patch: { court: "", caseValue: null, notes: "nova" } });
    expect(processUpdatePatch(patch)).toEqual({ court: null, case_value: null });
    expect(internalDetailsPatch(PROC, patch)).toEqual({ legal_process_id: PROC, notes: "nova" });
    expect(internalDetailsPatch(PROC, { title: "x" })).toBeNull();
  });

  it("parte: insert e PATCH", () => {
    const input = addPartySchema.parse({ processId: PROC, type: "PLAINTIFF", name: "Maria", document: "999.000.111-22" });
    expect(partyInsertRow("p1", input)).toEqual({ id: "p1", legal_process_id: PROC, party_type: "PLAINTIFF", name: "Maria", document_number: "99900011122", client_id: null });
    expect(partyUpdatePatch({ type: "OTHER", clientId: null })).toEqual({ party_type: "OTHER", client_id: null });
  });

  it("movimentação manual: origem sempre MANUAL e sem dado de integração", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    const out = manualEventRow("e1", createEventSchema.parse({ processId: PROC, title: "Ligação" }), now);
    expect(out).toEqual({
      id: "e1",
      legal_process_id: PROC,
      event_type: "MANUAL_NOTE",
      title: "Ligação",
      description: "Ligação",
      occurred_at: now.toISOString(),
      source: "MANUAL",
      important: false,
    });
    expect(out).not.toHaveProperty("external_provider");
    expect(out).not.toHaveProperty("raw_data");
  });
});

describe("repositório — partes puras", () => {
  it("SELECT por superfície: parceiro não lê colunas internas; valor da causa só com permissão", () => {
    const partner = processColumns("PARTNER", false);
    expect(partner).not.toMatch(/responsible_user_id|operational_due_at|created_by|case_value/);
    expect(processColumns("PARTNER", true)).toMatch(/case_value/);
    expect(processColumns("INTERNAL", true)).toMatch(/responsible_user_id.*case_value/);
    expect(partner).toMatch(/legal_cases!inner\(client_id\)/);
  });

  it("busca: dígitos (com máscara CNJ) → CNJ; texto → título; curingas escapados", () => {
    expect(searchTarget("0001234-56.2026")).toEqual({ kind: "cnj", digits: "0001234562026" });
    expect(searchTarget("Banco 123")).toEqual({ kind: "title", text: "Banco 123" });
    expect(searchTarget("12")).toEqual({ kind: "title", text: "12" });
    expect(searchTarget("   ")).toBeNull();
    expect(likePattern("50%_a\\")).toBe("%50\\%\\_a\\\\%");
  });
});
