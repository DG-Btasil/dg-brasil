import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { buildCsv } from "@/server/domain/exports/csv";
import type { ReceiptStatementItemDTO } from "./dto";
import { EXPENSE_EXPORT_COLUMNS, withReceiptShares } from "./export";
import type { AgreementListRow, ExpenseRow, ProcessFinanceRow, ReceiptStatementRow, ReceivableRow } from "./mappers";
import { listAgreementRowsSchema, listExpensesSchema, listProcessFinanceSchema, listReceiptStatementSchema, listReceivablesSchema } from "./schemas";

/**
 * Planilhas do Financeiro, com o repositório simulado (nada chega ao banco):
 * os mesmos filtros e ordem da lista, valores com vírgula, datas dd/mm/aaaa,
 * número CNJ com máscara, só ADMIN, e o registro na auditoria sem o conteúdo.
 */
vi.mock("./repository", () => ({
  listAgreementRows: vi.fn(),
  listReceivables: vi.fn(),
  listReceiptStatement: vi.fn(),
  listReceiptShares: vi.fn(),
  listExpenses: vi.fn(),
  listProcessFinance: vi.fn(),
  listOrganizationNames: vi.fn(),
}));

const repo = vi.mocked(await import("./repository"));
const service = await import("./service");

const OWNER = "11111111-1111-4111-8111-111111111111";
const PARTNER = "22222222-2222-4222-8222-222222222222";
const CASE = "66666666-6666-4666-8666-666666666666";
const PROCESS = "55555555-5555-4555-8555-555555555555";
const CNJ = "00012345620268190001";
const CNJ_MASKED = "0001234-56.2026.8.19.0001";
const CHUNK = { page: 1, pageSize: 500 };

const rpc = vi.fn(async () => ({ data: "audit-id", error: null }));
const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: { rpc } as unknown as SupabaseClient,
    requestId: "88888888-8888-4888-8888-888888888888",
    session: { userId: "99999999-9999-4999-8999-999999999999", organizationId: OWNER, role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });
const admin = () => ctxOf("ADMIN");
const lines = (content: string) => content.split("\r\n");
const audit = () => rpc.mock.calls.map((call) => (call as unknown[])[1]);

beforeEach(() => {
  vi.clearAllMocks();
  repo.listOrganizationNames.mockResolvedValue(new Map([[PARTNER, "Almeida Advogados"]]));
  repo.listReceiptShares.mockResolvedValue([]);
});

const agreementRow = (over: Partial<AgreementListRow> = {}): AgreementListRow =>
  ({
    id: "a1",
    legal_case_id: CASE,
    legal_process_id: PROCESS,
    fee_model_id: null,
    upfront_fee: "500.00",
    fixed_fee: "3000.00",
    installments: 6,
    monthly_fee: null,
    success_fee_percentage: "30.00",
    currency: "BRL",
    start_date: "2026-10-05",
    status: "ACTIVE",
    notes: null,
    created_by: null,
    created_at: "2026-10-01T15:00:00Z",
    updated_at: "2026-10-01T15:00:00Z",
    reopened_at: null,
    reopen_reason: null,
    fee_model_name: "Entrada e êxito",
    case_title: "Consignado Maria",
    case_origin_organization_id: OWNER,
    client_name: "Maria Fictícia",
    process_title: "Maria x Banco",
    cnj_number: CNJ,
    in_process_totals: true,
    contracted: "3500.00",
    received: "1250.50",
    outstanding: "2249.50",
    overdue: "500.00",
    open_payments: 5,
    next_due_date: "2026-12-10",
    ...over,
  }) as AgreementListRow;

describe("planilha de contratos de honorários", () => {
  it("mesmos filtros e ordem da lista; valores com vírgula, datas dd/mm/aaaa e CNJ com máscara; a busca não vai para a auditoria", async () => {
    repo.listAgreementRows.mockResolvedValue({ rows: [agreementRow(), agreementRow({ id: "a2", legal_process_id: null, process_title: null, cnj_number: null, fee_model_name: null, start_date: null, installments: null, in_process_totals: false, next_due_date: null })], total: 2 });
    const input = listAgreementRowsSchema.parse({ q: "Maria", status: "ACTIVE", periodFrom: "2026-10-01", periodTo: "2026-10-31", dueFrom: "2026-12-01", sortBy: "nextDueDate", sortDirection: "asc", page: 3 });
    const file = await service.exportAgreements(admin(), input);

    expect(repo.listAgreementRows.mock.calls[0]?.slice(1)).toEqual([
      { legalCaseId: undefined, legalProcessId: undefined, status: "ACTIVE", q: "Maria", periodFrom: "2026-10-01", periodTo: "2026-10-31", dueFrom: "2026-12-01", dueTo: undefined },
      CHUNK,
      { column: "next_due_date", ascending: true },
    ]);
    const [header, first, second] = lines(file.content);
    expect(header).toBe(
      "Cliente;Caso;Processo;Número CNJ;Modelo de honorários;Situação;Data do contrato;Entrada;Valor fixo;Parcelas;Mensalidade;Êxito (%);Contratado;Recebido;Em aberto;Em atraso;Parcelas em aberto;Próximo vencimento;Nos totais por processo",
    );
    expect(first).toBe(`Maria Fictícia;Consignado Maria;Maria x Banco;${CNJ_MASKED};Entrada e êxito;Ativo;05/10/2026;500,00;3000,00;6;;30;3500,00;1250,50;2249,50;500,00;5;10/12/2026;Sim`);
    // Contrato antigo, só do caso: sem processo, sem modelo, e a data é a do cadastro.
    expect(second).toBe("Maria Fictícia;Consignado Maria;;;Valores próprios;Ativo;01/10/2026;500,00;3000,00;;;30;3500,00;1250,50;2249,50;500,00;5;;Não");
    expect([file.fileName.startsWith("contratos-de-honorarios-"), file.rowCount, file.total, file.truncated]).toEqual([true, 2, 2, false]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_data_export", {
      p_kind: "finance_agreements",
      p_filters: { search: true, status: "ACTIVE", periodFrom: "2026-10-01", periodTo: "2026-10-31", dueFrom: "2026-12-01" },
      p_row_count: 2,
      p_truncated: false,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/Maria|3500/);
  });

  it("lista maior que o limite: sai cortada, avisa e registra o corte", async () => {
    repo.listAgreementRows.mockImplementation(async (_db, _filters, page) => ({ rows: Array.from({ length: page.pageSize }, (_, i) => agreementRow({ id: `a${page.page}-${i}` })), total: 7200 }));
    const file = await service.exportAgreements(admin(), listAgreementRowsSchema.parse({}));
    expect([file.rowCount, file.total, file.truncated, file.limit]).toEqual([5000, 7200, true, 5000]);
    expect(repo.listAgreementRows).toHaveBeenCalledTimes(10);
    expect(audit()[0]).toMatchObject({ p_row_count: 5000, p_truncated: true });
  });
});

describe("planilha do a receber", () => {
  const row = (over: Partial<ReceivableRow> = {}): ReceivableRow => ({
    payment_id: "p1",
    financial_agreement_id: "a1",
    legal_case_id: CASE,
    legal_process_id: PROCESS,
    agreement_status: "ACTIVE",
    amount: "1000.00",
    received_amount: "250.00",
    balance: "750.00",
    currency: "BRL",
    due_date: "2026-11-05",
    status: "OVERDUE",
    days_overdue: 8,
    payment_type: "FIXED",
    description: "Parcela 2 de 6",
    client_name: "Maria Fictícia",
    case_title: "Consignado Maria",
    process_title: "Maria x Banco",
    cnj_number: CNJ,
    in_process_totals: true,
    ...over,
  });

  it("período, só vencidas e ordem por vencimento chegam ao repositório; saldo e atraso na planilha", async () => {
    repo.listReceivables.mockResolvedValue({ rows: [row(), row({ payment_id: "p2", status: "PENDING", days_overdue: null, due_date: null, received_amount: "0", balance: "1000.00", description: null })], total: 2 });
    const file = await service.exportReceivables(admin(), listReceivablesSchema.parse({ from: "2026-11-01", to: "2026-11-30", overdueOnly: true }));

    expect(repo.listReceivables.mock.calls[0]?.slice(1)).toEqual([{ from: "2026-11-01", to: "2026-11-30", overdueOnly: true, q: undefined }, CHUNK, { column: "due_date", ascending: true }]);
    const [header, first, second] = lines(file.content);
    expect(header).toBe("Vencimento;Cliente;Caso;Processo;Número CNJ;Parcela;Descrição;Valor da parcela;Recebido;Saldo a receber;Situação;Dias de atraso;Situação do contrato;Nos totais por processo");
    expect(first).toBe(`05/11/2026;Maria Fictícia;Consignado Maria;Maria x Banco;${CNJ_MASKED};Parcela do valor fixo;Parcela 2 de 6;1000,00;250,00;750,00;Em atraso;8;Ativo;Sim`);
    expect(second).toBe(`;Maria Fictícia;Consignado Maria;Maria x Banco;${CNJ_MASKED};Parcela do valor fixo;;1000,00;0,00;1000,00;A vencer;;Ativo;Sim`);
    expect(audit()[0]).toEqual({ p_kind: "finance_receivables", p_filters: { from: "2026-11-01", to: "2026-11-30", overdueOnly: true }, p_row_count: 2, p_truncated: false });
  });
});

describe("planilha de recebimentos", () => {
  const row = (over: Partial<ReceiptStatementRow> = {}): ReceiptStatementRow => ({
    receipt_id: "r1",
    sequence: 41,
    kind: "RECEIPT",
    amount: "1000.00",
    currency: "BRL",
    occurred_at: "2026-11-10T15:00:00Z",
    occurred_on: "2026-11-10",
    method: "PIX",
    notes: null,
    payment_id: "p1",
    payment_type: "UPFRONT",
    payment_description: "Entrada",
    financial_agreement_id: "a1",
    legal_case_id: CASE,
    legal_process_id: PROCESS,
    client_name: "Maria Fictícia",
    case_title: "Consignado Maria",
    process_title: "Maria x Banco",
    cnj_number: CNJ,
    ...over,
  });

  it("forma, valor com sinal e a parte do escritório e do parceiro de cada lançamento", async () => {
    repo.listReceiptStatement.mockResolvedValue({
      rows: [row(), row({ receipt_id: "r2", sequence: 42, kind: "REVERSAL", amount: "-200.00", method: null, notes: "Estorno parcial" }), row({ receipt_id: "r3", sequence: 43, amount: "300.00", method: "BOLETO", legal_case_id: "outro", cnj_number: null, process_title: null })],
      total: 3,
    });
    repo.listReceiptShares.mockResolvedValue([
      { receipt_id: "r1", partner_amount: "300.00", case_partnership_agreements: { partner_organization_id: PARTNER } },
      { receipt_id: "r2", partner_amount: "-60.00", case_partnership_agreements: [{ partner_organization_id: PARTNER }] },
    ]);
    const input = listReceiptStatementSchema.parse({ from: "2026-11-01", to: "2026-11-13", method: "PIX", kind: "RECEIPT", q: "0001234" });
    const file = await service.exportReceiptStatement(admin(), input);

    expect(repo.listReceiptStatement.mock.calls[0]?.slice(1)).toEqual([{ from: "2026-11-01", to: "2026-11-13", method: "PIX", kind: "RECEIPT", q: "0001234" }, CHUNK, { column: "occurred_at", ascending: false }]);
    expect(repo.listReceiptShares.mock.calls[0]?.[1]).toEqual(["r1", "r2", "r3"]);
    const [header, first, second, third] = lines(file.content);
    expect(header).toBe("Data;Lançamento;Tipo;Cliente;Caso;Processo;Número CNJ;Parcela;Descrição da parcela;Forma de recebimento;Valor;Parte do escritório;Parte do parceiro;Parceiro;Observação");
    expect(first).toBe(`10/11/2026;41;Recebimento;Maria Fictícia;Consignado Maria;Maria x Banco;${CNJ_MASKED};Entrada;Entrada;Pix;1000,00;700,00;300,00;Almeida Advogados;`);
    // Estorno: tudo negativo, e as duas partes continuam somando o valor.
    expect(second).toBe(`10/11/2026;42;Estorno;Maria Fictícia;Consignado Maria;Maria x Banco;${CNJ_MASKED};Entrada;Entrada;;-200,00;-140,00;-60,00;Almeida Advogados;Estorno parcial`);
    // Caso sem parceria: tudo é do escritório.
    expect(third).toBe("10/11/2026;43;Recebimento;Maria Fictícia;Consignado Maria;;;Entrada;Entrada;Boleto;300,00;300,00;0,00;;");
    expect(audit()[0]).toEqual({ p_kind: "finance_receipts", p_filters: { from: "2026-11-01", to: "2026-11-13", method: "PIX", kind: "RECEIPT", search: true }, p_row_count: 3, p_truncated: false });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("0001234");
  });

  it("divisões são buscadas em blocos de 100 lançamentos; sem lançamento, nenhuma busca", async () => {
    repo.listReceiptStatement.mockResolvedValue({ rows: Array.from({ length: 230 }, (_, i) => row({ receipt_id: `r${i}`, sequence: i })), total: 230 });
    await service.exportReceiptStatement(admin(), listReceiptStatementSchema.parse({}));
    expect(repo.listReceiptShares.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 30]);

    vi.clearAllMocks();
    repo.listOrganizationNames.mockResolvedValue(new Map());
    repo.listReceiptStatement.mockResolvedValue({ rows: [], total: 0 });
    const empty = await service.exportReceiptStatement(admin(), listReceiptStatementSchema.parse({}));
    expect(repo.listReceiptShares).not.toHaveBeenCalled();
    expect([empty.rowCount, lines(empty.content)]).toEqual([0, [expect.stringContaining("Parte do parceiro"), ""]]);
  });

  it("a soma por lançamento não deixa centavo perdido (0,1 + 0,2)", () => {
    const item = { receiptId: "r1", amount: 0.3 } as ReceiptStatementItemDTO;
    const [out] = withReceiptShares(
      [item],
      [
        { receipt_id: "r1", partner_amount: "0.10", case_partnership_agreements: null },
        { receipt_id: "r1", partner_amount: "0.20", case_partnership_agreements: { partner_organization_id: PARTNER } },
      ],
      new Map([[PARTNER, "Almeida Advogados"]]),
    );
    expect([out?.partnerAmount, out?.ownerAmount, out?.partnerName]).toEqual([0.3, 0, "Almeida Advogados"]);
  });
});

describe("planilha de despesas", () => {
  const row = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
    id: "e1",
    legal_process_id: PROCESS,
    legal_case_id: CASE,
    category: "COURT_COSTS",
    description: "Custas iniciais",
    amount: "187.35",
    currency: "BRL",
    incurred_on: "2026-11-03",
    paid_on: "2026-11-04",
    reimbursable: true,
    supplier: "TJRJ",
    notes: null,
    created_by: null,
    created_at: "2026-11-03T12:00:00Z",
    updated_at: "2026-11-03T12:00:00Z",
    cancelled_at: null,
    cancellation_reason: null,
    legal_processes: { title: "Maria x Banco", cnj_number: CNJ, legal_cases: { title: "Consignado Maria", origin_organization_id: OWNER, clients: { individual_client_details: { full_name: "Maria Fictícia" } } } },
    ...over,
  }) as ExpenseRow;

  it("categoria, situação e período chegam ao repositório, sempre com o cliente e o processo", async () => {
    repo.listExpenses.mockResolvedValue({ rows: [row(), row({ id: "e2", paid_on: null, reimbursable: false, supplier: null, cancelled_at: "2026-11-06T13:00:00Z", cancellation_reason: "Lançada em duplicidade" })], total: 2 });
    const file = await service.exportExpenses(admin(), listExpensesSchema.parse({ processId: PROCESS, category: "COURT_COSTS", status: "PAID", from: "2026-11-01", to: "2026-11-30" }));

    expect(repo.listExpenses.mock.calls[0]?.slice(1)).toEqual([
      { processId: PROCESS, category: "COURT_COSTS", status: "PAID", from: "2026-11-01", to: "2026-11-30" },
      CHUNK,
      { column: "incurred_on", ascending: false },
      // Na planilha os rótulos do processo vêm sempre, mesmo no escopo de um processo.
      true,
    ]);
    const [header, first, second] = lines(file.content);
    expect(header).toBe("Data da despesa;Cliente;Processo;Número CNJ;Categoria;Descrição;Fornecedor;Valor;Situação;Paga em;Reembolsável;Observações;Cancelada em;Motivo do cancelamento");
    expect(first).toBe(`03/11/2026;Maria Fictícia;Maria x Banco;${CNJ_MASKED};Custas processuais;Custas iniciais;TJRJ;187,35;Paga;04/11/2026;Sim;;;`);
    expect(second).toBe(`03/11/2026;Maria Fictícia;Maria x Banco;${CNJ_MASKED};Custas processuais;Custas iniciais;;187,35;Cancelada;;Não;;06/11/2026;Lançada em duplicidade`);
    expect(audit()[0]).toEqual({ p_kind: "finance_expenses", p_filters: { processId: PROCESS, category: "COURT_COSTS", status: "PAID", from: "2026-11-01", to: "2026-11-30" }, p_row_count: 2, p_truncated: false });
  });

  it("descrição que começaria uma fórmula não vira fórmula na planilha", () => {
    const csv = buildCsv(EXPENSE_EXPORT_COLUMNS, [{ id: "e1", legalProcessId: PROCESS, legalCaseId: CASE, category: "OTHER", description: "=1+1", amount: 10, currency: "BRL", incurredOn: "2026-11-03", reimbursable: false, status: "OPEN", createdAt: "2026-11-03", updatedAt: "2026-11-03" }]);
    expect(lines(csv)[1]).toContain(";'=1+1;");
  });
});

describe("planilha do financeiro por processo", () => {
  const row = (over: Partial<ProcessFinanceRow> = {}): ProcessFinanceRow => ({
    legal_process_id: PROCESS,
    legal_case_id: CASE,
    client_id: "c1",
    client_name: "Maria Fictícia",
    cnj_number: CNJ,
    display_title: "Maria x Banco",
    case_title: "Consignado Maria",
    status: "ACTIVE",
    phase: "APPEAL",
    created_at: "2026-10-01T15:00:00Z",
    case_value: "20000.00",
    fee_amount: "6000.00",
    fee_percentage: "30.00",
    partner_organization_id: PARTNER,
    partner_percentage: "33.33",
    owner_percentage: "66.67",
    fee_owner_share: "4000.20",
    fee_partner_share: "1999.80",
    contracted: "3500.00",
    received: "1000.00",
    open_balance: "2500.00",
    overdue: "500.00",
    agreement_count: 1,
    received_partner_share: "333.30",
    received_owner_share: "666.70",
    expenses_total: "187.35",
    expenses_paid: "187.35",
    expenses_open: "0",
    expenses_reimbursable: "187.35",
    expense_count: 1,
    net_result: "479.35",
    ...over,
  });

  it("filtros e ordem da tela; honorários, recebido e despesas com a parte do escritório e do parceiro", async () => {
    repo.listProcessFinance.mockResolvedValue({ rows: [row(), row({ legal_process_id: "p2", cnj_number: null, phase: null, case_value: null, fee_amount: null, fee_percentage: null, partner_organization_id: null, partner_percentage: "0", owner_percentage: "100", fee_owner_share: "0", fee_partner_share: "0", received_partner_share: "0", received_owner_share: "1000.00", net_result: "-187.35" })], total: 2 });
    const file = await service.exportProcessFinance(admin(), listProcessFinanceSchema.parse({ q: "Maria", overdueOnly: true, sortBy: "net", sortDirection: "desc" }));

    expect(repo.listProcessFinance.mock.calls[0]?.slice(1)).toEqual([{ q: "Maria", legalCaseId: undefined, overdueOnly: true, openExpensesOnly: undefined, withoutAgreement: undefined }, CHUNK, { column: "net_result", ascending: false }]);
    const [header, first, second] = lines(file.content);
    expect(header).toBe(
      "Cliente;Processo;Número CNJ;Caso;Situação;Fase;Valor da causa;Honorários;Honorários (%);Parceiro;Parceiro (%);Honorários: parte do escritório;Honorários: parte do parceiro;Contratado;Recebido;Recebido: parte do escritório;Recebido: parte do parceiro;Em aberto;Em atraso;Contratos;Despesas;Despesas pagas;Despesas a pagar;Despesas reembolsáveis;Resultado",
    );
    const cells = first?.split(";") ?? [];
    expect(cells.slice(0, 4)).toEqual(["Maria Fictícia", "Maria x Banco", CNJ_MASKED, "Consignado Maria"]);
    expect(cells.slice(6)).toEqual(["20000,00", "6000,00", "30", "Almeida Advogados", "33,33", "4000,20", "1999,80", "3500,00", "1000,00", "666,70", "333,30", "2500,00", "500,00", "1", "187,35", "187,35", "0,00", "187,35", "479,35"]);
    // Processo sem parceiro e sem honorários cadastrados: colunas em branco; resultado negativo sai como número.
    const other = second?.split(";") ?? [];
    expect([other[2], other[5], other[6], other[7], other[8], other[9], other[10], other[24]]).toEqual(["", "", "", "", "", "", "", "-187,35"]);
    expect(audit()[0]).toEqual({ p_kind: "finance_processes", p_filters: { search: true, overdueOnly: true }, p_row_count: 2, p_truncated: false });
  });
});

describe("quem exporta as planilhas do Financeiro", () => {
  it("só ADMIN: advogado, assistente e parceiro são recusados antes de ler qualquer lista, e nada é registrado", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      const ctx = ctxOf(role);
      const attempts = [
        service.exportAgreements(ctx, listAgreementRowsSchema.parse({})),
        service.exportReceivables(ctx, listReceivablesSchema.parse({})),
        service.exportReceiptStatement(ctx, listReceiptStatementSchema.parse({})),
        service.exportExpenses(ctx, listExpensesSchema.parse({})),
        service.exportProcessFinance(ctx, listProcessFinanceSchema.parse({})),
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const list of [repo.listAgreementRows, repo.listReceivables, repo.listReceiptStatement, repo.listExpenses, repo.listProcessFinance, repo.listOrganizationNames]) expect(list).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("se o registro na auditoria falha, não há arquivo", async () => {
    repo.listReceivables.mockResolvedValue({ rows: [], total: 0 });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Somente o administrador exporta planilhas" } } as never);
    await expect(service.exportReceivables(admin(), listReceivablesSchema.parse({}))).rejects.toMatchObject({ publicMessage: "Somente o administrador exporta planilhas" });
  });
});
