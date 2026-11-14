import { describe, expect, it } from "vitest";
import {
  agreementInsert,
  agreementListItemFromRow,
  financeSummaryFromRaw,
  receiptStatementItemFromRow,
  receiptStatementTotalsFromRaw,
  receivableFromRow,
  receivablesTotalsFromRaw,
  agreementShareFromRows,
  agreementUpdate,
  allocationFromRow,
  expenseFromRow,
  expenseInsert,
  expensesByCategory,
  expenseStatusOf,
  expenseUpdate,
  feeModelUpdate,
  monthlyPaidExpenses,
  money,
  partnershipInternalFromRow,
  partnershipPartnerFromRow,
  paymentFromRows,
  processFinanceFromRow,
  processFinanceTotalsFromRow,
  receiptFromRow,
  shareTotals,
  transferInternalFromRow,
  transferPartnerFromRow,
  type AgreementListRow,
  type AllocationBalanceRow,
  type ExpenseRow,
  type PartnershipRow,
  type ProcessFinanceRow,
  type TransferRow,
} from "./mappers";
import { financeSearch, processFinanceSearch } from "./repository";
import { createAgreementSchema, createExpenseSchema } from "./schemas";

const partnershipRow: PartnershipRow = {
  id: "pa-1",
  legal_case_id: "case-1",
  partner_organization_id: "org-a",
  partner_percentage: "30.00",
  owner_percentage: "70.00",
  effective_at: "2026-10-01T10:00:00Z",
  created_by: "user-admin",
  created_at: "2026-10-01T10:00:00Z",
  cancelled_at: null,
  cancelled_by: null,
  cancellation_reason: "motivo interno sigiloso",
};

const transferRow: TransferRow = {
  id: "t-1",
  partner_organization_id: "org-a",
  amount: 150.5,
  status: "CANCELLED",
  paid_at: null,
  reference: "PIX 123",
  registered_by: "user-admin",
  cancelled_at: "2026-10-02T10:00:00Z",
  cancellation_reason: "erro de digitação do financeiro",
  created_at: "2026-10-02T09:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
};

describe("money", () => {
  it("numeric do PostgREST (texto ou número) vira número com 2 casas", () => {
    expect(money("100.10")).toBe(100.1);
    expect(money(0.1 + 0.2)).toBe(0.3);
    expect(money("-33.33")).toBe(-33.33);
  });
});

describe("obrigação", () => {
  it("recebido, saldo e status vêm da view; não existe paidAmount", () => {
    const dto = paymentFromRows(
      {
        payment_id: "p-1",
        financial_agreement_id: "fa-1",
        legal_case_id: "case-1",
        amount: "1000.00",
        currency: "BRL",
        due_date: "2026-11-01",
        received_amount: "400.00",
        balance: "600.00",
        last_receipt_at: "2026-10-05T12:00:00Z",
        status: "PARTIAL",
      },
      { id: "p-1", payment_type: "FIXED", description: "Parcela 1", cancelled_at: null, cancellation_reason: null, created_at: "2026-10-01T00:00:00Z" },
    );
    expect(dto).toMatchObject({ amount: 1000, receivedAmount: 400, balance: 600, status: "PARTIAL", uiStatus: "PARTIALLY_PAID", paymentType: "FIXED" });
    expect(dto).not.toHaveProperty("paidAmount");
  });

  it("CANCELLED não tem status de front (null)", () => {
    const dto = paymentFromRows(
      {
        payment_id: "p-2",
        financial_agreement_id: "fa-1",
        legal_case_id: "case-1",
        amount: 10,
        currency: "BRL",
        due_date: null,
        received_amount: 0,
        balance: 10,
        last_receipt_at: null,
        status: "CANCELLED",
      },
      undefined,
    );
    expect(dto.uiStatus).toBeNull();
    expect(dto.dueDate).toBeUndefined();
  });
});

describe("ledger e divisão", () => {
  it("estorno mantém o sinal negativo e aponta o original", () => {
    const dto = receiptFromRow({
      id: "r-2",
      sequence: 7,
      payment_id: "p-1",
      kind: "REVERSAL",
      amount: "-50.00",
      currency: "BRL",
      occurred_at: "2026-10-05T12:00:00Z",
      original_receipt_id: "r-1",
      method: null,
      notes: null,
      created_by: "user-admin",
      created_at: "2026-10-05T12:00:00Z",
    });
    expect(dto).toMatchObject({ kind: "REVERSAL", amount: -50, originalReceiptId: "r-1", sequence: 7 });
    expect(dto.method).toBeUndefined();
  });

  it("divisão interna traz parceiro e escritório como o banco gravou", () => {
    const dto = allocationFromRow({
      id: "al-1",
      sequence: 1,
      receipt_id: "r-1",
      case_partnership_agreement_id: "pa-1",
      reverses_allocation_id: null,
      base_amount: "100.00",
      partner_percentage: "33.33",
      partner_amount: "33.33",
      owner_amount: "66.67",
      created_at: "2026-10-05T12:00:00Z",
    });
    expect(dto).toMatchObject({ baseAmount: 100, partnerAmount: 33.33, ownerAmount: 66.67, partnerPercentage: 33.33 });
  });
});

describe("DTO do parceiro (sanitização)", () => {
  it("snapshot do parceiro não tem percentual/valor do escritório nem dado interno", () => {
    const dto = partnershipPartnerFromRow(partnershipRow);
    expect(dto).toEqual({ id: "pa-1", legalCaseId: "case-1", partnerPercentage: 30, effectiveAt: "2026-10-01T10:00:00Z", status: "ACTIVE", cancelledAt: undefined });
    for (const field of ["ownerPercentage", "partnerOrganizationId", "createdBy", "cancelledBy", "cancellationReason"]) {
      expect(dto).not.toHaveProperty(field);
    }
    expect(JSON.stringify(dto)).not.toContain("sigiloso");
  });

  it("snapshot interno traz o histórico completo", () => {
    const dto = partnershipInternalFromRow({ ...partnershipRow, cancelled_at: "2026-10-03T00:00:00Z", cancelled_by: "user-admin" });
    expect(dto).toMatchObject({ ownerPercentage: 70, status: "CANCELLED", cancellationReason: "motivo interno sigiloso" });
  });

  it("repasse do parceiro não tem quem registrou nem motivo interno, mesmo recebendo a linha completa", () => {
    const dto = transferPartnerFromRow(transferRow);
    expect(dto).toEqual({
      id: "t-1",
      amount: 150.5,
      status: "CANCELLED",
      paidAt: undefined,
      reference: "PIX 123",
      cancelledAt: "2026-10-02T10:00:00Z",
      createdAt: "2026-10-02T09:00:00Z",
    });
    expect(JSON.stringify(dto)).not.toContain("erro de digitação");
    expect(dto).not.toHaveProperty("registeredBy");
    expect(dto).not.toHaveProperty("partnerOrganizationId");
  });

  it("repasse interno traz itens só quando pedidos", () => {
    expect(transferInternalFromRow(transferRow)).not.toHaveProperty("items");
    const withItems = transferInternalFromRow(transferRow, [{ allocation_id: "al-1", amount: "150.50", created_at: "x" }]);
    expect(withItems.items).toEqual([{ allocationId: "al-1", amount: 150.5, createdAt: "x" }]);
    expect(withItems.cancellationReason).toBe("erro de digitação do financeiro");
  });

  it("participação por caso só tem totais do parceiro", () => {
    const balances: AllocationBalanceRow[] = [
      { allocation_id: "al-1", case_partnership_agreement_id: "pa-1", net_partner_amount: "30.00", transferred_amount: "10.00", paid_amount: "10.00" },
      { allocation_id: "al-2", case_partnership_agreement_id: "pa-other", net_partner_amount: "999.00", transferred_amount: 0, paid_amount: 0 },
    ];
    const dto = agreementShareFromRows(partnershipRow, balances);
    expect(dto).toEqual({
      agreementId: "pa-1",
      legalCaseId: "case-1",
      partnerPercentage: 30,
      effectiveAt: "2026-10-01T10:00:00Z",
      status: "ACTIVE",
      cancelledAt: undefined,
      accruedAmount: 30,
      pendingTransferAmount: 0,
      paidOutAmount: 10,
      availableAmount: 20,
      // Base da participação (4.3.1): o parceiro já lia base_amount das divisões dele pela RLS.
      eligibleRevenue: 0,
    });
    for (const field of ["ownerAmount", "ownerPercentage", "baseAmount", "receiptId", "cancellationReason"]) {
      expect(dto).not.toHaveProperty(field);
    }
  });
});

describe("totais do parceiro (soma em centavos do que o banco derivou)", () => {
  it("sem erro de ponto flutuante", () => {
    const rows = Array.from({ length: 10 }, () => ({ net_partner_amount: "0.10", transferred_amount: "0.10", paid_amount: "0.00" }));
    expect(shareTotals(rows)).toEqual({ accruedAmount: 1, pendingTransferAmount: 1, paidOutAmount: 0, availableAmount: 0 });
  });

  it("repasse cancelado já não está em transferred (regra do banco): disponível volta", () => {
    expect(shareTotals([{ net_partner_amount: 50, transferred_amount: 0, paid_amount: 0 }]).availableAmount).toBe(50);
  });
});

describe("domínio → colunas", () => {
  it("acordo: status decidido pelo service, autor da sessão, caso lido do processo; chaves ausentes não viram coluna; a chave de idempotência é gravada pelo repositório", () => {
    const input = createAgreementSchema.parse({ legalProcessId: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01", fixedFee: 1200, activate: true, idempotencyKey: "9b2d4c6e-1a3f-4e5b-8c7d-0f1e2d3c4b5a" });
    expect(agreementInsert(input, "actor-1", "case-from-process")).toEqual({
      legal_case_id: "case-from-process",
      legal_process_id: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01",
      fixed_fee: 1200,
      status: "ACTIVE",
      created_by: "actor-1",
    });
  });

  it("PATCH: null limpa, ausente não mexe", () => {
    expect(agreementUpdate({ notes: null, upfrontFee: 10 })).toEqual({ notes: null, upfront_fee: 10 });
    expect(feeModelUpdate({ active: false, successFeePercent: null })).toEqual({ active: false, success_fee_percentage: null });
  });
});

/* ------------------------------------------------------------------ */
/* Financeiro por processo (046)                                       */
/* ------------------------------------------------------------------ */

const processRow: ProcessFinanceRow = {
  legal_process_id: "proc-1",
  legal_case_id: "case-1",
  client_id: "client-1",
  client_name: "Maria Teste",
  cnj_number: "00012345620268260100",
  display_title: null,
  case_title: "Revisional — Banco X",
  status: "ACTIVE" as ProcessFinanceRow["status"],
  phase: null,
  created_at: "2026-10-01T00:00:00Z",
  case_value: "50000.00",
  fee_amount: "10000.00",
  fee_percentage: "30.00",
  partner_organization_id: "org-a",
  partner_percentage: "40.00",
  owner_percentage: "60.00",
  fee_owner_share: "6000.00",
  fee_partner_share: "4000.00",
  contracted: "3000.00",
  received: "1000.10",
  open_balance: "1999.90",
  overdue: "500.00",
  agreement_count: 1,
  received_partner_share: "400.04",
  received_owner_share: "600.06",
  expenses_total: "350.00",
  expenses_paid: "200.00",
  expenses_open: "150.00",
  expenses_reimbursable: "100.00",
  expense_count: 3,
  net_result: "400.06",
};

const expenseRow: ExpenseRow = {
  id: "exp-1",
  legal_process_id: "proc-1",
  legal_case_id: "case-1",
  category: "COURT_COSTS",
  description: "Custas iniciais",
  amount: "150.35",
  currency: "BRL ",
  incurred_on: "2026-10-01",
  paid_on: null,
  reimbursable: true,
  supplier: null,
  notes: null,
  created_by: "user-admin",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  cancelled_at: null,
  cancellation_reason: null,
};

describe("visão por processo (view process_finance_overview)", () => {
  it("numeric do banco vira número; título cai no do caso; divisão vem pronta do banco", () => {
    const dto = processFinanceFromRow(processRow);
    expect(dto).toMatchObject({
      legalProcessId: "proc-1",
      title: "Revisional — Banco X",
      clientName: "Maria Teste",
      caseValue: 50000,
      feeAmount: 10000,
      feePercentage: 30,
      ownerPercentage: 60,
      partnerPercentage: 40,
      feeOwnerShare: 6000,
      feePartnerShare: 4000,
      received: 1000.1,
      receivedPartnerShare: 400.04,
      receivedOwnerShare: 600.06,
      expensesOpen: 150,
      netResult: 400.06,
      agreementCount: 1,
      expenseCount: 3,
    });
    expect(dto.phase).toBeUndefined();
  });

  it("título próprio do processo prevalece; valores ausentes ficam ausentes (não viram zero)", () => {
    const dto = processFinanceFromRow({ ...processRow, display_title: "  Ação revisional nº 2 ", case_value: null, fee_amount: null, fee_percentage: null, partner_organization_id: null });
    expect(dto.title).toBe("Ação revisional nº 2");
    expect(dto.caseValue).toBeUndefined();
    expect(dto.feeAmount).toBeUndefined();
    expect(dto.partnerOrganizationId).toBeUndefined();
  });

  it("totais: sem linha = zeros", () => {
    expect(processFinanceTotalsFromRow(null)).toMatchObject({ processCount: 0, receivedTotal: 0, netResultTotal: 0 });
    expect(processFinanceTotalsFromRow({ process_count: 2, case_value_total: "1.10", fee_total: "0.20", fee_owner_total: 0, fee_partner_total: 0, contracted_total: 0, received_total: "0.30", received_owner_total: 0, received_partner_total: 0, open_total: 0, overdue_total: 0, expenses_total: 0, expenses_paid_total: 0, expenses_open_total: 0, net_result_total: "-5.50" })).toMatchObject({
      processCount: 2,
      caseValueTotal: 1.1,
      receivedTotal: 0.3,
      netResultTotal: -5.5,
    });
  });

  it("busca: dígitos (com ou sem máscara) = prefixo do CNJ; texto = cliente/título com curinga escapado", () => {
    expect(processFinanceSearch("0001234-56.2026")).toEqual({ kind: "cnj", digits: "0001234562026" });
    expect(processFinanceSearch("  ")).toBeNull();
    const text = processFinanceSearch('Maria 50%, "x"');
    expect(text?.kind).toBe("text");
    // ILIKE escapa o % do usuário (\%); dentro das aspas do PostgREST a barra e as aspas são escapadas de novo.
    const quoted = String.raw`"%Maria 50\\%, \"x\"%"`;
    expect(text && text.kind === "text" ? text.or : "").toBe(`client_name.ilike.${quoted},display_title.ilike.${quoted},case_title.ilike.${quoted}`);
  });
});

describe("contrato na lista (view finance_agreement_list, 064): nada é somado no servidor do painel", () => {
  const base: AgreementListRow = {
    id: "fa-1",
    legal_case_id: "case-1",
    legal_process_id: "proc-1",
    fee_model_id: null,
    upfront_fee: null,
    fixed_fee: "1000.00",
    installments: 2,
    monthly_fee: null,
    success_fee_percentage: null,
    currency: "BRL",
    start_date: null,
    status: "ACTIVE",
    notes: null,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    reopened_at: null,
    reopen_reason: null,
    fee_model_name: "Modelo A",
    case_title: "Caso X",
    case_origin_organization_id: "org",
    client_name: "Maria Teste",
    process_title: "Caso X",
    cnj_number: "123",
    in_process_totals: true,
    contracted: "1500.10",
    received: "600.05",
    outstanding: "900.05",
    overdue: "300.00",
    open_payments: 2,
    next_due_date: "2026-11-15",
  };

  it("rótulos, totais e próximo vencimento vêm prontos do banco", () => {
    expect(agreementListItemFromRow(base)).toMatchObject({
      legalProcessId: "proc-1",
      processTitle: "Caso X",
      cnjNumber: "123",
      caseTitle: "Caso X",
      clientName: "Maria Teste",
      feeModelName: "Modelo A",
      nextDueDate: "2026-11-15",
      inProcessTotals: true,
      totals: { contracted: 1500.1, received: 600.05, outstanding: 900.05, overdue: 300, openPayments: 2 },
    });
  });

  it("contrato antigo (sem processo) não tem rótulo de processo e fica fora dos totais por processo", () => {
    const legacy = agreementListItemFromRow({ ...base, legal_process_id: null, process_title: null, cnj_number: null, in_process_totals: false, next_due_date: null, fee_model_name: null });
    expect(legacy.legalProcessId).toBeUndefined();
    expect(legacy.processTitle).toBeUndefined();
    expect(legacy.nextDueDate).toBeUndefined();
    expect(legacy.feeModelName).toBeUndefined();
    expect(legacy.inProcessTotals).toBe(false);
  });

  it("reabertura: data e motivo chegam à tela; sem reabertura, ausentes", () => {
    expect(agreementListItemFromRow(base).reopenedAt).toBeUndefined();
    expect(agreementListItemFromRow({ ...base, reopened_at: "2026-11-13T12:00:00Z", reopen_reason: "Pix devolvido" })).toMatchObject({ reopenedAt: "2026-11-13T12:00:00Z", reopenReason: "Pix devolvido" });
  });
});

describe("visão geral (public.finance_summary, 064)", () => {
  const raw = {
    totals: { contracted: 1500.1, received: "600.05", outstanding: 900.05, overdue: 300, open_payments: 2 },
    outside: { contracted: 201, received: 0, outstanding: 201, overdue: 0, open_payments: 5 },
    agreements_by_status: { DRAFT: 1, ACTIVE: 3, COMPLETED: 2, CANCELLED: 0 },
    monthly: [
      { month: "2026-10", amount: "0.00" },
      { month: "2026-11", amount: 400 },
    ],
  };

  it("totais por processo e o que fica fora chegam separados (a Home e o Financeiro leem os mesmos)", () => {
    const dto = financeSummaryFromRaw(raw, []);
    expect(dto.totals).toEqual({ contracted: 1500.1, received: 600.05, outstanding: 900.05, overdue: 300, openPayments: 2 });
    expect(dto.outside).toEqual({ contracted: 201, received: 0, outstanding: 201, overdue: 0, openPayments: 5 });
    expect(dto.agreementsByStatus).toEqual({ DRAFT: 1, ACTIVE: 3, COMPLETED: 2, CANCELLED: 0 });
    expect(dto.monthly).toEqual([
      { month: "2026-10", amount: 0 },
      { month: "2026-11", amount: 400 },
    ]);
    expect(dto.truncated).toBe(false);
  });
});

describe("extrato de recebimentos e a receber (064)", () => {
  it("linha do extrato: valor com sinal, dia de São Paulo, cliente e processo", () => {
    const item = receiptStatementItemFromRow({
      receipt_id: "r-1",
      sequence: 7,
      kind: "REVERSAL",
      amount: "-300.00",
      currency: "BRL",
      occurred_at: "2025-11-01T02:30:00Z",
      occurred_on: "2025-10-31",
      method: null,
      notes: "Pix devolvido",
      payment_id: "p-1",
      payment_type: "FIXED",
      payment_description: "Parcela 1/3",
      financial_agreement_id: "fa-1",
      legal_case_id: "case-1",
      legal_process_id: null,
      client_name: "Maria Teste",
      case_title: "Caso X",
      process_title: null,
      cnj_number: null,
    });
    expect(item).toMatchObject({ receiptId: "r-1", sequence: 7, kind: "REVERSAL", amount: -300, occurredOn: "2025-10-31", clientName: "Maria Teste", caseTitle: "Caso X", paymentDescription: "Parcela 1/3" });
    expect(item.method).toBeUndefined();
    expect(item.processTitle).toBeUndefined();
    expect(item.legalProcessId).toBeUndefined();
  });

  it("total do período: função sem linhas (ou falha de leitura tratada) vale zero", () => {
    expect(receiptStatementTotalsFromRaw({ count: 3, received: "1300.00", deducted: "-300.00", net: 1000 })).toEqual({ count: 3, received: 1300, deducted: -300, net: 1000 });
    expect(receiptStatementTotalsFromRaw(null)).toEqual({ count: 0, received: 0, deducted: 0, net: 0 });
  });

  it("a receber: dias de atraso só na vencida; marca do que fica fora dos totais", () => {
    const row = {
      payment_id: "p-1",
      financial_agreement_id: "fa-1",
      legal_case_id: "case-1",
      legal_process_id: "proc-1",
      agreement_status: "ACTIVE" as const,
      amount: "1000.00",
      received_amount: "400.00",
      balance: "600.00",
      currency: "BRL",
      due_date: "2026-01-10",
      status: "OVERDUE" as const,
      days_overdue: 12,
      payment_type: "FIXED" as const,
      description: null,
      client_name: "Maria Teste",
      case_title: "Caso X",
      process_title: "Processo A",
      cnj_number: null,
      in_process_totals: true,
    };
    expect(receivableFromRow(row)).toMatchObject({ paymentId: "p-1", balance: 600, receivedAmount: 400, daysOverdue: 12, status: "OVERDUE", processTitle: "Processo A", inProcessTotals: true });
    const pending = receivableFromRow({ ...row, status: "PENDING", days_overdue: null, due_date: null, in_process_totals: false });
    expect(pending.daysOverdue).toBeUndefined();
    expect(pending.dueDate).toBeUndefined();
    expect(pending.inProcessTotals).toBe(false);
    expect(receivablesTotalsFromRaw({ count: 3, total: "770.00", overdue: "270.00", overdue_count: 2, outside_totals: "70.00" })).toEqual({ count: 3, total: 770, overdue: 270, overdueCount: 2, outsideTotals: 70, draftTotal: 0, draftCount: 0 });
    expect(receivablesTotalsFromRaw({ count: 1, total: "10.00", overdue: "0", overdue_count: 0, outside_totals: "0", draft_total: "450.50", draft_count: 1 })).toMatchObject({ draftTotal: 450.5, draftCount: 1 });
    expect(receivablesTotalsFromRaw(undefined)).toEqual({ count: 0, total: 0, overdue: 0, overdueCount: 0, outsideTotals: 0, draftTotal: 0, draftCount: 0 });
  });

  it("busca das listas novas: mesma regra da visão por processo, na coluna da view; o padrão das funções de total vai escapado", () => {
    expect(financeSearch("0001234-56.2026", "process_title")).toEqual({ kind: "cnj", digits: "0001234562026" });
    const text = financeSearch("Maria 50%_", "process_title");
    expect(text).toMatchObject({ kind: "text", pattern: String.raw`%Maria 50\%\_%` });
    expect(text && text.kind === "text" ? text.or : "").toContain("process_title.ilike.");
    expect(text && text.kind === "text" ? text.or : "").not.toContain("display_title");
  });
});

describe("despesas do processo", () => {
  it("situação derivada: cancelada › paga › a pagar", () => {
    expect(expenseStatusOf({ cancelled_at: null, paid_on: null })).toBe("OPEN");
    expect(expenseStatusOf({ cancelled_at: null, paid_on: "2026-10-02" })).toBe("PAID");
    expect(expenseStatusOf({ cancelled_at: "2026-10-03T00:00:00Z", paid_on: "2026-10-02" })).toBe("CANCELLED");
  });

  it("linha → DTO; rótulos do processo só com o embed", () => {
    const dto = expenseFromRow(expenseRow);
    expect(dto).toMatchObject({ amount: 150.35, currency: "BRL", status: "OPEN", reimbursable: true, incurredOn: "2026-10-01" });
    expect(dto).not.toHaveProperty("processTitle");
    const labeled = expenseFromRow({
      ...expenseRow,
      legal_processes: { title: null, cnj_number: "999", legal_cases: { title: "Caso Y", origin_organization_id: "org", clients: { individual_client_details: null, company_client_details: [{ legal_name: "Empresa Z" }] } } },
    });
    expect(labeled).toMatchObject({ processTitle: "Caso Y", cnjNumber: "999", clientName: "Empresa Z" });
  });

  it("insert: caso do processo (servidor), autor da sessão; nada de cancelamento", () => {
    const input = createExpenseSchema.parse({ processId: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01", idempotencyKey: "9b2d4c6e-1a3f-4e5b-8c7d-0f1e2d3c4b5a", category: "EXPERT_FEE", description: "Perito", amount: 800, incurredOn: "2026-10-05" });
    expect(expenseInsert(input, "case-1", "actor-1")).toEqual({
      legal_process_id: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01",
      legal_case_id: "case-1",
      category: "EXPERT_FEE",
      description: "Perito",
      amount: 800,
      incurred_on: "2026-10-05",
      reimbursable: false,
      created_by: "actor-1",
    });
  });

  it("PATCH: só as chaves presentes; null limpa (paid_on null = volta a pagar)", () => {
    expect(expenseUpdate({ paidOn: null, supplier: "Fórum" })).toEqual({ paid_on: null, supplier: "Fórum" });
    expect(expenseUpdate({ paidOn: "2026-10-10" })).toEqual({ paid_on: "2026-10-10" });
  });

  it("por categoria: pagas × a pagar, canceladas fora, maior total primeiro, centavos exatos", () => {
    const rows = [
      { category: "COURT_COSTS" as const, amount: "0.10", paid_on: "2026-10-01", cancelled_at: null },
      { category: "COURT_COSTS" as const, amount: "0.20", paid_on: null, cancelled_at: null },
      { category: "EXPERT_FEE" as const, amount: "800.00", paid_on: null, cancelled_at: null },
      { category: "HEARING" as const, amount: "999.00", paid_on: null, cancelled_at: "2026-10-02T00:00:00Z" },
    ];
    expect(expensesByCategory(rows)).toEqual([
      { category: "EXPERT_FEE", paid: 0, open: 800, total: 800, count: 1 },
      { category: "COURT_COSTS", paid: 0.1, open: 0.2, total: 0.3, count: 2 },
    ]);
  });

  it("pagas por mês: pela data do pagamento, só nos meses pedidos; a pagar e canceladas fora", () => {
    const months = ["2026-09", "2026-10"];
    const out = monthlyPaidExpenses(
      [
        { amount: "100.00", paid_on: "2026-10-31", cancelled_at: null },
        { amount: "50.00", paid_on: "2026-09-01", cancelled_at: null },
        { amount: "70.00", paid_on: null, cancelled_at: null },
        { amount: "30.00", paid_on: "2026-10-05", cancelled_at: "2026-10-06T00:00:00Z" },
        { amount: "10.00", paid_on: "2025-01-01", cancelled_at: null },
      ],
      months,
    );
    expect(out).toEqual([
      { month: "2026-09", amount: 50 },
      { month: "2026-10", amount: 100 },
    ]);
  });
});
