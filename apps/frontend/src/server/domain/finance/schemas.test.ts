import { describe, expect, it } from "vitest";
import {
  cancelExpenseSchema,
  cancelTransferSchema,
  createAgreementSchema,
  createExpenseSchema,
  createPaymentSchema,
  createTransferSchema,
  listAgreementsSchema,
  listAllocationsSchema,
  listExpensesSchema,
  listPaymentsSchema,
  listProcessFinanceSchema,
  listTransfersSchema,
  processFinanceSchema,
  registerAdjustmentSchema,
  registerReceiptSchema,
  registerReversalSchema,
  todaySaoPaulo,
  updateExpenseSchema,
  updatePaymentSchema,
} from "./schemas";

const ID = "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01";
const KEY = "9b2d4c6e-1a3f-4e5b-8c7d-0f1e2d3c4b5a";

describe("dinheiro", () => {
  it("aceita até 2 casas; recusa 3 casas, negativo, zero e texto", () => {
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: 10.25, paymentType: "FIXED" }).success).toBe(true);
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: 10.255, paymentType: "FIXED" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: -1, paymentType: "FIXED" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: 0, paymentType: "FIXED" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: "10", paymentType: "FIXED" }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ idempotencyKey: KEY, agreementId: ID, amount: 1e13, paymentType: "FIXED" }).success).toBe(false);
  });

  it("valores clássicos de ponto flutuante com 2 casas passam", () => {
    for (const v of [0.1, 0.29, 1.005 - 0.005, 19.99, 1234567.89]) {
      expect(registerReceiptSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, amount: v }).success, String(v)).toBe(true);
    }
  });
});

describe("ledger", () => {
  it("recebimento sem valor = quitar o saldo", () => {
    expect(registerReceiptSchema.parse({ idempotencyKey: KEY, paymentId: ID })).toEqual({ idempotencyKey: KEY, paymentId: ID });
  });

  it("data do recebimento não pode estar no futuro", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(registerReceiptSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, occurredAt: future }).success).toBe(false);
    expect(registerReceiptSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, occurredAt: new Date().toISOString() }).success).toBe(true);
  });

  it("ajuste exige justificativa e direção; valor sempre positivo", () => {
    expect(registerAdjustmentSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, direction: "DECREASE", amount: 5 }).success).toBe(false);
    expect(registerAdjustmentSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, direction: "DECREASE", amount: 5, justification: "   " }).success).toBe(false);
    expect(registerAdjustmentSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, direction: "DECREASE", amount: -5, justification: "x" }).success).toBe(false);
    expect(registerAdjustmentSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, direction: "INCREASE", amount: 5, justification: "Diferença de câmbio" }).success).toBe(true);
  });

  it("estorno não aceita obrigação do navegador (só o lançamento original)", () => {
    const parsed = registerReversalSchema.parse({ idempotencyKey: KEY, originalReceiptId: ID, paymentId: ID, amount: 10 });
    expect(parsed).not.toHaveProperty("paymentId");
    expect(registerReversalSchema.safeParse({ idempotencyKey: KEY, originalReceiptId: "x" }).success).toBe(false);
  });

  it("não existe campo de valor pago na obrigação", () => {
    const parsed = updatePaymentSchema.parse({ id: ID, patch: { amount: 10, paidAmount: 10 } });
    expect(parsed.patch).not.toHaveProperty("paidAmount");
    expect(updatePaymentSchema.safeParse({ id: ID, patch: { paidAmount: 10 } }).success).toBe(false);
  });
});

describe("repasses e divisão", () => {
  it("repasse não aceita divisão/percentual nem itens do navegador", () => {
    const parsed = createTransferSchema.parse({
      idempotencyKey: KEY,
      partnerOrganizationId: ID,
      amount: 100,
      partnerPercentage: 90,
      items: [{ allocationId: ID, amount: 100 }],
    });
    expect(parsed).toEqual({ idempotencyKey: KEY, partnerOrganizationId: ID, amount: 100 });
  });

  it("cancelamento exige motivo", () => {
    expect(cancelTransferSchema.safeParse({ id: ID }).success).toBe(false);
    expect(cancelTransferSchema.safeParse({ id: ID, reason: "  " }).success).toBe(false);
    expect(cancelTransferSchema.safeParse({ id: ID, reason: "Pago em duplicidade" }).success).toBe(true);
  });

  it("divisões: ao menos um filtro", () => {
    expect(listAllocationsSchema.safeParse({}).success).toBe(false);
    expect(listAllocationsSchema.safeParse({ legalCaseId: ID }).success).toBe(true);
  });
});

describe("idempotência por chave", () => {
  it("toda escrita que cria registro exige chave UUID do formulário", () => {
    expect(createPaymentSchema.safeParse({ agreementId: ID, amount: 10, paymentType: "FIXED" }).success).toBe(false);
    expect(registerReceiptSchema.safeParse({ paymentId: ID }).success).toBe(false);
    expect(registerReceiptSchema.safeParse({ paymentId: ID, idempotencyKey: "clique-1" }).success).toBe(false);
    expect(registerAdjustmentSchema.safeParse({ paymentId: ID, direction: "INCREASE", amount: 5, justification: "x" }).success).toBe(false);
    expect(registerReversalSchema.safeParse({ originalReceiptId: ID }).success).toBe(false);
    expect(createTransferSchema.safeParse({ partnerOrganizationId: ID, amount: 10 }).success).toBe(false);
    expect(createAgreementSchema.safeParse({ legalProcessId: ID }).success).toBe(false);
    expect(createAgreementSchema.safeParse({ legalProcessId: ID, idempotencyKey: KEY }).success).toBe(true);
  });
});

describe("contrato do processo (046)", () => {
  it("exige o processo; o caso nunca vem do navegador", () => {
    expect(createAgreementSchema.safeParse({ legalCaseId: ID, idempotencyKey: KEY }).success).toBe(false);
    const parsed = createAgreementSchema.parse({ legalProcessId: ID, legalCaseId: ID, idempotencyKey: KEY });
    expect(parsed).not.toHaveProperty("legalCaseId");
    expect(parsed).toMatchObject({ legalProcessId: ID, activate: false });
  });

  it("lista de contratos filtra por processo", () => {
    expect(listAgreementsSchema.parse({ legalProcessId: ID })).toMatchObject({ legalProcessId: ID, column: "created_at", ascending: false });
    expect(listAgreementsSchema.safeParse({ legalProcessId: "x" }).success).toBe(false);
  });
});

describe("financeiro por processo (046)", () => {
  it("ordenação só pela whitelist; padrão = maior recebido", () => {
    expect(listProcessFinanceSchema.parse({})).toMatchObject({ page: 1, pageSize: 25, column: "received", ascending: false });
    expect(listProcessFinanceSchema.parse({ sortBy: "net", sortDirection: "asc" })).toMatchObject({ column: "net_result", ascending: true });
    expect(listProcessFinanceSchema.parse({ sortBy: "expenses" })).toMatchObject({ column: "expenses_total" });
    expect(listProcessFinanceSchema.parse({ sortBy: "title" })).toMatchObject({ column: "display_title" });
    expect(listProcessFinanceSchema.safeParse({ sortBy: "net_result; drop table" }).success).toBe(false);
  });

  it("filtros booleanos e busca com limite", () => {
    expect(listProcessFinanceSchema.parse({ q: "  Maria ", overdueOnly: true, openExpensesOnly: true, withoutAgreement: true })).toMatchObject({
      q: "Maria",
      overdueOnly: true,
      openExpensesOnly: true,
      withoutAgreement: true,
    });
    expect(listProcessFinanceSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(listProcessFinanceSchema.safeParse({ overdueOnly: "sim" }).success).toBe(false);
  });

  it("processo do detalhe precisa ser UUID", () => {
    expect(processFinanceSchema.safeParse({ processId: ID }).success).toBe(true);
    expect(processFinanceSchema.safeParse({ processId: "1" }).success).toBe(false);
  });
});

describe("despesas do processo (046)", () => {
  const base = { processId: ID, idempotencyKey: KEY, category: "COURT_COSTS", description: "Custas iniciais", amount: 150.35, incurredOn: "2026-10-01" };

  it("nova despesa: categoria do check do banco, valor > 0 com 2 casas, descrição obrigatória; sem pagamento = a pagar", () => {
    expect(createExpenseSchema.parse(base)).toEqual({ ...base, reimbursable: false });
    expect(createExpenseSchema.safeParse({ ...base, category: "LUNCH" }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, amount: 1.005 }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, description: "   " }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, description: "x".repeat(501) }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, incurredOn: "2026-02-30" }).success).toBe(false);
  });

  it("caso, autor e cancelamento nunca vêm do navegador", () => {
    const parsed = createExpenseSchema.parse({ ...base, legalCaseId: ID, createdBy: ID, cancelledAt: "2026-10-01T00:00:00Z" });
    for (const field of ["legalCaseId", "createdBy", "cancelledAt"]) expect(parsed).not.toHaveProperty(field);
  });

  it("data do pagamento não pode estar no futuro; a da despesa pode (audiência marcada)", () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect(createExpenseSchema.safeParse({ ...base, paidOn: tomorrow }).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, paidOn: todaySaoPaulo() }).success).toBe(true);
    expect(createExpenseSchema.safeParse({ ...base, incurredOn: tomorrow }).success).toBe(true);
  });

  it("PATCH: ausente não mexe, null limpa (paidOn null = volta a pagar); vazio é recusado; processo não muda", () => {
    expect(updateExpenseSchema.parse({ id: ID, patch: { paidOn: null, supplier: null } }).patch).toEqual({ paidOn: null, supplier: null });
    expect(updateExpenseSchema.safeParse({ id: ID, patch: {} }).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ id: ID, patch: { processId: ID } }).success).toBe(false);
    expect(updateExpenseSchema.safeParse({ id: ID, patch: { amount: -1 } }).success).toBe(false);
  });

  it("cancelar exige motivo", () => {
    expect(cancelExpenseSchema.safeParse({ id: ID }).success).toBe(false);
    expect(cancelExpenseSchema.safeParse({ id: ID, reason: "  " }).success).toBe(false);
    expect(cancelExpenseSchema.safeParse({ id: ID, reason: "Lançada em duplicidade" }).success).toBe(true);
  });

  it("lista: filtros por processo, categoria e situação; padrão = data da despesa, mais recente primeiro", () => {
    expect(listExpensesSchema.parse({ processId: ID, category: "HEARING", status: "OPEN" })).toMatchObject({ processId: ID, category: "HEARING", status: "OPEN", column: "incurred_on", ascending: false });
    expect(listExpensesSchema.safeParse({ status: "PENDING" }).success).toBe(false);
    expect(listExpensesSchema.safeParse({ sortBy: "description" }).success).toBe(false);
  });

  it("hoje em São Paulo: 01h UTC ainda é o dia anterior", () => {
    expect(todaySaoPaulo(new Date("2026-11-07T01:00:00Z"))).toBe("2026-11-06");
    expect(todaySaoPaulo(new Date("2026-11-07T04:00:00Z"))).toBe("2026-11-07");
  });
});

describe("listagens", () => {
  it("paginação e ordenação só por whitelist", () => {
    const parsed = listPaymentsSchema.parse({ agreementId: ID });
    expect(parsed).toMatchObject({ page: 1, pageSize: 25, column: "due_date", ascending: true });
    expect(listPaymentsSchema.safeParse({ sortBy: "received_amount; drop table" }).success).toBe(false);
    expect(listTransfersSchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });
});
