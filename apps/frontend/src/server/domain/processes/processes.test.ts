import { describe, expect, it } from "vitest";
import { PROCESS_STATUSES } from "@/lib/constants/status";
import {
  activeProcessTotal,
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
  processDisplayTitle,
  processInsertRow,
  processUpdatePatch,
  statusCountsFromRows,
  UNNAMED_PROCESS,
  type ProcessRow,
} from "./mappers";
import { buildCsv } from "@/server/domain/exports/csv";
import { processExportColumns, type ProcessExportRow } from "./export";
import { cnjPattern, likePattern, orQuoted, processColumns, searchTarget, titleSearchFilter } from "./repository";
const KEY = "11111111-1111-4111-8111-111111111111";

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
  phase: "PROCEEDINGS",
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
    const ok = createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", cnj: "0001234-03.2026.8.26.0100" });
    expect(ok.cnj).toBe(CNJ);
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", cnj: "1234-56.2026" }).success).toBe(false);
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", cnj: "000123403202682601000" }).success).toBe(false);
    expect(createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", cnj: "  " }).cnj).toBeUndefined();
  });

  it("título é opcional (o processo é exibido com o nome do caso); prazo inicial também", () => {
    const parsed = createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE });
    expect(parsed.title).toBeUndefined();
    expect(parsed.nextDeadline).toBeUndefined();
    expect(createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "  " }).title).toBeUndefined();
    expect(createPartnerProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE }).success).toBe(true);
  });

  it("honorários: valor em reais (≥ 0, 2 casas) e êxito 0–100; parceiro não informa", () => {
    expect(createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, feeAmount: 2500.5, feePercentage: 30 })).toMatchObject({ feeAmount: 2500.5, feePercentage: 30 });
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, feeAmount: -1 }).success).toBe(false);
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, feePercentage: 100.5 }).success).toBe(false);
    const partner = createPartnerProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, feeAmount: 10, feePercentage: 10 });
    expect(partner).not.toHaveProperty("feeAmount");
    expect(partner).not.toHaveProperty("feePercentage");
  });

  it("processo sem caso não passa (nunca órfão)", () => {
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, title: "P" }).success).toBe(false);
    expect(createPartnerProcessSchema.safeParse({ idempotencyKey: KEY, title: "P", legalCaseId: "x" }).success).toBe(false);
  });

  it("valor da causa: não negativo e no máximo 2 casas", () => {
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", caseValue: -1 }).success).toBe(false);
    expect(createProcessSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", caseValue: 10.123 }).success).toBe(false);
    expect(createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", caseValue: 10.12 }).caseValue).toBe(10.12);
  });

  it("parceiro não informa campo interno: status, responsável e notas são descartados", () => {
    const parsed = createPartnerProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", status: "ARCHIVED", responsibleUserId: USER, notes: "x", summary: "y" });
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
    expect(updateProcessSchema.parse({ id: PROC, patch: { title: "" } }).patch.title).toBeNull();
  });

  it("status e fases da 045: novos aceitos, antigos recusados", () => {
    for (const status of ["SENTENCED", "APPEAL", "FINAL_JUDGMENT", "ENFORCEMENT", "RECEIVED", "ARCHIVED"]) {
      expect(updateProcessSchema.safeParse({ id: PROC, patch: { status } }).success).toBe(true);
    }
    for (const status of ["WAITING_CLIENT", "WAITING_DEADLINE", "CLOSED"]) {
      expect(updateProcessSchema.safeParse({ id: PROC, patch: { status } }).success).toBe(false);
    }
    expect(updateProcessSchema.safeParse({ id: PROC, patch: { phase: "PROCEEDINGS" } }).success).toBe(true);
    for (const phase of ["PLEADINGS", "EVIDENCE", "JUDGMENT"]) {
      expect(updateProcessSchema.safeParse({ id: PROC, patch: { phase } }).success).toBe(false);
    }
  });

  it("listagem: ordenação só por whitelist; status do banco aceito", () => {
    const parsed = listProcessesSchema.parse({ sortBy: "cnj", sortDirection: "asc", status: "RECEIVED" });
    expect(parsed).toMatchObject({ column: "cnj_number", ascending: true, status: "RECEIVED", page: 1, pageSize: 25 });
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
    const p = internalProcessFromRows(row(), { summary: "resumo interno", notes: "nota interna", fee_amount: "3000.00", fee_percentage: 25 }, true);
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
      feeAmount: 3000,
      feePercentage: 25,
    });
    expect(internalProcessFromRows(row(), null, true)).toMatchObject({ feeAmount: undefined, feePercentage: undefined });
  });

  it("status do banco = status do front (ARCHIVED é Arquivado, sem tradução)", () => {
    expect(internalProcessFromRows(row({ status: "ARCHIVED" }), null, true).status).toBe("ARCHIVED");
    expect(listItemFromRow(row({ status: "RECEIVED" }), { surface: "PARTNER", canViewCaseValue: false }).status).toBe("RECEIVED");
  });

  it("nome exibido: título próprio; sem ele, o do caso; nunca vazio", () => {
    expect(partnerProcessFromRow(row(), false).title).toBe("Revisional consignado");
    expect(partnerProcessFromRow(row({ title: null, legal_cases: { client_id: CLIENT, title: "Caso Maria x Banco" } }), false).title).toBe("Caso Maria x Banco");
    expect(processDisplayTitle(null, null)).toBe(UNNAMED_PROCESS);
  });

  it("contagem por status: todos os status na ordem da tela, zero onde não há; ativos sem recebido/arquivado", () => {
    const counts = statusCountsFromRows([
      { status: "ARCHIVED", total: 4 },
      { status: "ACTIVE", total: "7" },
      { status: "RECEIVED", total: 2 },
      { status: "SUSPENDED", total: 1 },
      { status: "LEGADO", total: 9 },
    ]);
    expect(counts.map((c) => c.status)).toEqual([...PROCESS_STATUSES]);
    expect(counts.find((c) => c.status === "ACTIVE")?.count).toBe(7);
    expect(counts.find((c) => c.status === "FILED")?.count).toBe(0);
    expect(activeProcessTotal(counts)).toBe(8);
  });

  it("ficha do parceiro não tem nenhum campo interno, mesmo se a linha trouxer", () => {
    const p = partnerProcessFromRow(row(), true);
    for (const field of ["responsibleUserId", "operationalDueAt", "createdBy", "summary", "notes", "feeAmount", "feePercentage"]) {
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
    const input = createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "P", cnj: CNJ, unit: "Vara", actionType: "Classe", clientPole: "PASSIVE", status: "FILED", summary: "s", notes: "n" });
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
    expect(internalDetailsRow(PROC, { notes: undefined })).toBeNull();
  });

  it("cadastro interno sem título: a coluna não vai (o banco grava null; a tela mostra o caso)", () => {
    const input = createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "", status: "PRE_FILING", phase: "PRELIMINARY" });
    expect(processInsertRow(PROC, input, "INTERNAL")).not.toHaveProperty("title");
  });

  it("honorários vão para os dados internos (p_internal: fee_amount, fee_percentage)", () => {
    const input = createProcessSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, feeAmount: 1200, feePercentage: 30 });
    expect(internalDetailsRow(PROC, input)).toEqual({ legal_process_id: PROC, fee_amount: 1200, fee_percentage: 30 });
    expect(processInsertRow(PROC, input, "INTERNAL")).not.toHaveProperty("fee_amount");
  });

  it("cadastro do parceiro: lista fechada (status/responsável/honorários nunca vão ao banco)", () => {
    const sneaky = { legalCaseId: CASE, title: "P", status: "ARCHIVED", responsibleUserId: USER, operationalDueAt: "2026-01-01T00:00:00Z", technicalOrigin: "INTEGRATION", feeAmount: 10 };
    const out = processInsertRow(PROC, sneaky as never, "PARTNER");
    expect(out).toEqual({ id: PROC, legal_case_id: CASE, technical_origin: "MANUAL", title: "P" });
  });

  it("edição: PATCH com só as chaves presentes; null limpa; notas e honorários vão para a tabela interna", () => {
    const { patch } = updateProcessSchema.parse({ id: PROC, patch: { court: "", caseValue: null, notes: "nova" } });
    expect(processUpdatePatch(patch)).toEqual({ court: null, case_value: null });
    expect(internalDetailsPatch(PROC, patch)).toEqual({ legal_process_id: PROC, notes: "nova" });
    expect(internalDetailsPatch(PROC, { title: "x" })).toBeNull();
    const fees = updateProcessSchema.parse({ id: PROC, patch: { feeAmount: 800, feePercentage: null } }).patch;
    expect(processUpdatePatch(fees)).toEqual({});
    expect(internalDetailsPatch(PROC, fees)).toEqual({ legal_process_id: PROC, fee_amount: 800, fee_percentage: null });
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
    // O caso vem junto (cliente, título, origem, parceiro e nome do cliente, com a RLS de quem pergunta).
    expect(partner).toMatch(/legal_cases!inner\(client_id, title, origin_organization_id, partner_organization_id, clients!/);
    expect(partner).not.toMatch(/internal_notes|assigned_lawyer_id/);
  });

  it("busca: dígitos (com máscara CNJ) → CNJ; texto → título; curingas escapados", () => {
    expect(searchTarget("0001234-56.2026")).toEqual({ kind: "cnj", digits: "0001234562026" });
    // Busca do cabeçalho (C3): os 20 dígitos sem pontuação, com o zero à esquerda, vão para o número CNJ.
    expect(searchTarget("09173538620268190042")).toEqual({ kind: "cnj", digits: "09173538620268190042" });
    expect(cnjPattern("09173538620268190042")).toBe("%09173538620268190042%");
    expect(searchTarget("Banco 123")).toEqual({ kind: "title", text: "Banco 123" });
    expect(searchTarget("12")).toEqual({ kind: "title", text: "12" });
    expect(searchTarget("   ")).toBeNull();
    expect(likePattern("50%_a\\")).toBe("%50\\%\\_a\\\\%");
  });

  it("busca por texto: título do processo OU casos com título parecido; texto do usuário entre aspas", () => {
    const pattern = likePattern('Maria, "x"');
    expect(titleSearchFilter(pattern, [])).toBe(`title.ilike.${orQuoted(pattern)}`);
    expect(titleSearchFilter(pattern, [CASE, CLIENT])).toBe(`title.ilike."%Maria, \\"x\\"%",legal_case_id.in.(${CASE},${CLIENT})`);
  });

  it("número CNJ casa por QUALQUER trecho, com ou sem máscara (não só pelo começo)", () => {
    // O fim do número, o ano com o tribunal, o número inteiro com máscara: tudo vira "contém estes dígitos".
    expect(cnjPattern("8190001")).toBe("%8190001%");
    const masked = searchTarget("56.2026.8.19");
    expect(masked).toEqual({ kind: "cnj", digits: "562026819" });
    expect(cnjPattern(masked?.kind === "cnj" ? masked.digits : "")).toBe("%562026819%");
    expect(cnjPattern("0001234-56.2026.8.19.0001")).toBe("%00012345620268190001%");
  });
});

describe("planilha de processos", () => {
  const item: ProcessExportRow = {
    id: "p1",
    legalCaseId: CASE,
    clientId: CLIENT,
    clientName: "Maria Teste",
    caseTitle: "Consignado Maria",
    origin: "MANUAL",
    cnj: "00012345620268190001",
    title: "Maria x Banco",
    court: "TJRJ",
    state: "RJ",
    status: "ACTIVE",
    phase: "APPEAL",
    distributionDate: "2026-03-05",
    caseValue: 15000.5,
    nextDeadline: { id: "d1", title: "Réplica", dueAt: "2026-12-03T21:00:00Z", dueDateLocal: "2026-12-03" },
    responsibleName: "Lucas Advogado",
    createdAt: "2026-10-01T15:00:00Z",
    updatedAt: "2026-11-13T15:00:00Z",
  };

  it("número CNJ com máscara (o Excel não o estraga), datas dd/mm/aaaa, valor com vírgula, próximo prazo e responsável", () => {
    const lines = buildCsv(processExportColumns(true), [item]).split("\r\n");
    expect(lines[0]).toBe("Número CNJ;Processo;Cliente;Caso;Tribunal;UF;Classe;Situação;Fase;Origem do cadastro;Distribuição;Valor da causa;Próximo prazo;Prazo;Responsável;Cadastrado em;Atualizado em");
    const cells = lines[1]?.split(";") ?? [];
    expect(cells[0]).toBe("0001234-56.2026.8.19.0001");
    expect([cells[1], cells[2], cells[3], cells[4], cells[5]]).toEqual(["Maria x Banco", "Maria Teste", "Consignado Maria", "TJRJ", "RJ"]);
    expect([cells[10], cells[11], cells[12], cells[13], cells[14], cells[15]]).toEqual(["05/03/2026", "15000,50", "03/12/2026", "Réplica", "Lucas Advogado", "01/10/2026"]);
  });

  it("sem permissão para o valor da causa, a coluna nem existe; processo sem número e sem prazo sai em branco", () => {
    const lines = buildCsv(processExportColumns(false), [{ ...item, cnj: undefined, nextDeadline: undefined, caseValue: undefined, responsibleName: undefined }]).split("\r\n");
    expect(lines[0]).not.toContain("Valor da causa");
    expect(lines[0]?.split(";")).toHaveLength(16);
    const cells = lines[1]?.split(";") ?? [];
    expect([cells[0], cells[11], cells[12], cells[13]]).toEqual(["", "", "", ""]);
  });
});
