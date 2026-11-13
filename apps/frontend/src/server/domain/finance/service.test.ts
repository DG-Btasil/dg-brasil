import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import type { AgreementRow, PaymentBalanceRow, ReceiptRow } from "./mappers";

/**
 * Regras do service do financeiro que a revisão final mudou (064), com o
 * repositório simulado: nada chega ao banco. As mesmas regras são conferidas
 * de verdade, no banco, em supabase/tests/verificar.mjs (bloco 064).
 */
vi.mock("./repository", () => ({
  findByIdempotencyKey: vi.fn(async () => null),
  insertIdempotent: vi.fn(async () => ({ id: "novo", deduplicated: false })),
  getAgreement: vi.fn(),
  getPaymentBalance: vi.fn(),
  getReceipt: vi.fn(),
  reversedAmountOf: vi.fn(async () => []),
  updateAgreementWhere: vi.fn(async () => undefined),
  countOpenPayments: vi.fn(async () => 0),
  updateOpenPayment: vi.fn(async () => undefined),
  getProcessRef: vi.fn(async () => ({ id: PROCESS, legal_case_id: CASE })),
  isPartnerOrganization: vi.fn(async () => true),
  createTransferRpc: vi.fn(),
  getFinanceSummary: vi.fn(),
  contractedByFeeModel: vi.fn(async () => []),
  listReceiptStatement: vi.fn(),
  receiptStatementTotals: vi.fn(),
  listReceivables: vi.fn(),
  receivablesTotals: vi.fn(),
  listAgreementRows: vi.fn(async () => ({ rows: [], total: 0 })),
}));

const repo = vi.mocked(await import("./repository"));
const service = await import("./service");

const USER = "99999999-9999-4999-8999-999999999999";
const ORG = "11111111-1111-4111-8111-111111111111";
const AGREEMENT = "22222222-2222-4222-8222-222222222222";
const PAYMENT = "33333333-3333-4333-8333-333333333333";
const RECEIPT = "44444444-4444-4444-8444-444444444444";
const PROCESS = "55555555-5555-4555-8555-555555555555";
const CASE = "66666666-6666-4666-8666-666666666666";
const KEY = "77777777-7777-4777-8777-777777777777";

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: "88888888-8888-4888-8888-888888888888",
    session: { userId: USER, organizationId: ORG, role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });
const admin = ctxOf("ADMIN");

const agreement = (status: AgreementRow["status"]): AgreementRow => ({
  id: AGREEMENT,
  legal_case_id: CASE,
  legal_process_id: PROCESS,
  fee_model_id: null,
  upfront_fee: null,
  fixed_fee: "1000.00",
  installments: null,
  monthly_fee: null,
  success_fee_percentage: null,
  currency: "BRL",
  start_date: null,
  status,
  notes: null,
  created_by: USER,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
});
const balance = (over: Partial<PaymentBalanceRow> = {}): PaymentBalanceRow => ({
  payment_id: PAYMENT,
  financial_agreement_id: AGREEMENT,
  legal_case_id: CASE,
  amount: "800.00",
  currency: "BRL",
  due_date: "2026-01-10",
  received_amount: "800.00",
  balance: "0.00",
  last_receipt_at: null,
  status: "PAID",
  ...over,
});
const receipt = (over: Partial<ReceiptRow> = {}) =>
  ({ id: RECEIPT, sequence: 1, payment_id: PAYMENT, kind: "RECEIPT", amount: "800.00", currency: "BRL", occurred_at: "2026-10-01T15:00:00Z", original_receipt_id: null, method: "PIX", notes: null, created_by: USER, created_at: "2026-10-01T15:00:00Z", ...over }) as ReceiptRow;

async function failure(run: Promise<unknown>): Promise<DomainError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error("a operação deveria ter sido recusada");
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.findByIdempotencyKey.mockResolvedValue(null);
  repo.insertIdempotent.mockResolvedValue({ id: "novo", deduplicated: false });
  repo.reversedAmountOf.mockResolvedValue([]);
  repo.getReceipt.mockResolvedValue(receipt());
  repo.getPaymentBalance.mockResolvedValue(balance());
});

describe("estorno depois de concluir o contrato: precisa reabrir", () => {
  it("contrato concluído ou cancelado: estorno recusado com o caminho na mensagem; nada é gravado", async () => {
    for (const [status, word] of [
      ["COMPLETED", "concluído"],
      ["CANCELLED", "cancelado"],
    ] as const) {
      repo.getAgreement.mockResolvedValue(agreement(status));
      const error = await failure(service.registerReversal(admin, { idempotencyKey: KEY, originalReceiptId: RECEIPT }));
      expect(error.code).toBe("INVALID_STATE");
      expect(error.message).toBe(`Este contrato está ${word}. Reabra o contrato antes de registrar estorno ou ajuste.`);
    }
    expect(repo.insertIdempotent).not.toHaveBeenCalled();
  });

  it("contrato ativo: o estorno sem valor estorna o que resta do recebimento", async () => {
    repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
    repo.reversedAmountOf.mockResolvedValue([-300]);
    await service.registerReversal(admin, { idempotencyKey: KEY, originalReceiptId: RECEIPT });
    expect(repo.insertIdempotent).toHaveBeenCalledWith(admin.db, "payment_receipts", expect.objectContaining({ kind: "REVERSAL", amount: -500, original_receipt_id: RECEIPT, payment_id: PAYMENT }), USER, KEY);
  });

  it("reenvio do mesmo formulário devolve o estorno já gravado, mesmo com o contrato concluído de novo", async () => {
    repo.findByIdempotencyKey.mockResolvedValue("ja-gravado");
    repo.getAgreement.mockResolvedValue(agreement("COMPLETED"));
    expect(await service.registerReversal(admin, { idempotencyKey: KEY, originalReceiptId: RECEIPT })).toEqual({ receiptId: "ja-gravado", deduplicated: true });
  });
});

describe("reabrir contrato (ADMIN, com motivo)", () => {
  it("concluído ou cancelado volta a ativo, com o motivo e a data na mesma gravação, condicionada à situação lida", async () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      repo.getAgreement.mockResolvedValue(agreement(status));
      await service.reopenAgreement(admin, { id: AGREEMENT, reason: "Pix devolvido" });
      expect(repo.updateAgreementWhere).toHaveBeenLastCalledWith(admin.db, AGREEMENT, [status], { status: "ACTIVE", reopen_reason: "Pix devolvido", reopened_at: expect.any(String) });
    }
  });

  it("rascunho e ativo não se reabrem", async () => {
    for (const status of ["DRAFT", "ACTIVE"] as const) {
      repo.getAgreement.mockResolvedValue(agreement(status));
      const error = await failure(service.reopenAgreement(admin, { id: AGREEMENT, reason: "x" }));
      expect(error.code).toBe("INVALID_STATE");
    }
    expect(repo.updateAgreementWhere).not.toHaveBeenCalled();
  });

  it("só quem gerencia o financeiro: advogado, assistente e parceiro são recusados antes de qualquer leitura", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      const error = await failure(service.reopenAgreement(ctxOf(role), { id: AGREEMENT, reason: "x" }));
      expect(error.code).toBe("FORBIDDEN");
    }
    expect(repo.getAgreement).not.toHaveBeenCalled();
  });

  it("mudar a situação direto para ativo, de um contrato concluído, é recusado e aponta a reabertura", async () => {
    repo.getAgreement.mockResolvedValue(agreement("COMPLETED"));
    const error = await failure(service.changeAgreementStatus(admin, { id: AGREEMENT, to: "ACTIVE" }));
    expect(error.message).toBe("Para voltar a ativo, reabra o contrato informando o motivo.");
    expect(repo.updateAgreementWhere).not.toHaveBeenCalled();
  });
});

describe("ajuste: sempre em contrato ativo; para menos, sempre com o recebimento corrigido", () => {
  const base = { idempotencyKey: KEY, paymentId: PAYMENT, amount: 50, justification: "Tarifa" };

  it("para menos sem original é recusado no campo (mesmo chamando o service sem a Server Action)", async () => {
    repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
    const error = await failure(service.registerAdjustment(admin, { ...base, direction: "DECREASE" }));
    expect(error.code).toBe("VALIDATION");
    expect(error.fieldErrors?.originalReceiptId?.[0]).toBe("Escolha o recebimento que este ajuste corrige.");
    expect(repo.insertIdempotent).not.toHaveBeenCalled();
  });

  it("para menos em contrato concluído: precisa reabrir (antes valia em qualquer situação)", async () => {
    repo.getAgreement.mockResolvedValue(agreement("COMPLETED"));
    const error = await failure(service.registerAdjustment(admin, { ...base, direction: "DECREASE", originalReceiptId: RECEIPT }));
    expect(error.message).toBe("Este contrato está concluído. Reabra o contrato antes de registrar estorno ou ajuste.");
  });

  it("para menos não passa do que resta do recebimento corrigido", async () => {
    repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
    repo.reversedAmountOf.mockResolvedValue([-780]);
    const error = await failure(service.registerAdjustment(admin, { ...base, direction: "DECREASE", originalReceiptId: RECEIPT }));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(repo.insertIdempotent).not.toHaveBeenCalled();
  });

  it("para menos com original em contrato ativo: lançamento negativo apontando o original", async () => {
    repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
    await service.registerAdjustment(admin, { ...base, direction: "DECREASE", originalReceiptId: RECEIPT });
    expect(repo.insertIdempotent).toHaveBeenCalledWith(admin.db, "payment_receipts", expect.objectContaining({ kind: "ADJUSTMENT", amount: -50, original_receipt_id: RECEIPT }), USER, KEY);
  });

  it("recebimento de outra parcela não serve de original", async () => {
    repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
    repo.getReceipt.mockResolvedValue(receipt({ payment_id: "outra-parcela" }));
    const error = await failure(service.registerAdjustment(admin, { ...base, direction: "DECREASE", originalReceiptId: RECEIPT }));
    expect(error.fieldErrors?.originalReceiptId?.[0]).toBe("O recebimento escolhido não é desta parcela.");
  });
});

describe("recebimento: instante gravado nunca no futuro", () => {
  it("data de hoje enviada de manhã (meio-dia) é gravada como o agora", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-13T12:00:00Z")); // 09h em São Paulo
      repo.getAgreement.mockResolvedValue(agreement("ACTIVE"));
      repo.getPaymentBalance.mockResolvedValue(balance({ received_amount: "0.00", balance: "800.00", status: "PENDING" }));
      await service.registerReceipt(admin, { idempotencyKey: KEY, paymentId: PAYMENT, occurredAt: "2026-11-13T12:00:00-03:00" });
      expect(repo.insertIdempotent).toHaveBeenCalledWith(admin.db, "payment_receipts", expect.objectContaining({ kind: "RECEIPT", amount: 800, occurred_at: "2026-11-13T12:00:00.000Z" }), USER, KEY);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("despesa: chave de idempotência", () => {
  const input = { idempotencyKey: KEY, processId: PROCESS, category: "COURT_COSTS" as const, description: "Custas", amount: 100, incurredOn: "2026-10-01", reimbursable: false };

  it("primeiro envio grava com a chave; o caso vem do processo", async () => {
    expect(await service.createExpense(admin, input)).toEqual({ id: "novo", deduplicated: false });
    const [, table, values, actor, key] = repo.insertIdempotent.mock.calls[0];
    expect([table, actor, key]).toEqual(["process_expenses", USER, KEY]);
    expect(values).toMatchObject({ legal_process_id: PROCESS, legal_case_id: CASE, amount: 100, created_by: USER });
    expect(values).not.toHaveProperty("idempotencyKey");
  });

  it("reenvio com a mesma chave devolve a despesa já lançada, sem gravar outra", async () => {
    repo.findByIdempotencyKey.mockResolvedValue("ja-lancada");
    expect(await service.createExpense(admin, input)).toEqual({ id: "ja-lancada", deduplicated: true });
    expect(repo.insertIdempotent).not.toHaveBeenCalled();
  });
});

describe("repasse acima do saldo real", () => {
  it("a recusa do banco vira mensagem que explica o saldo", async () => {
    repo.createTransferRpc.mockRejectedValue(new DomainError("INVALID_STATE", "Saldo disponível insuficiente para o repasse"));
    const error = await failure(service.createTransfer(admin, { idempotencyKey: KEY, partnerOrganizationId: ORG, amount: 300 }));
    expect(error.code).toBe("BUSINESS_RULE");
    expect(error.message).toContain("saldo disponível do parceiro");
  });
});

describe("visão geral: os totais vêm somados do banco", () => {
  it("o service só traduz o que o banco devolveu (a mesma conta para a Home e o Financeiro)", async () => {
    repo.getFinanceSummary.mockResolvedValue({
      totals: { contracted: 1000, received: 400, outstanding: 600, overdue: 0, open_payments: 2 },
      outside: { contracted: 201, received: 0, outstanding: 201, overdue: 0, open_payments: 5 },
      agreements_by_status: { DRAFT: 0, ACTIVE: 1, COMPLETED: 0, CANCELLED: 0 },
      monthly: [{ month: "2026-11", amount: 400 }],
    });
    const summary = await service.getFinanceSummary(admin);
    expect(summary.totals.outstanding).toBe(600);
    expect(summary.outside).toMatchObject({ outstanding: 201, openPayments: 5 });
    expect(repo.getFinanceSummary).toHaveBeenCalledWith(admin.db, 12);
    const error = await failure(service.getFinanceSummary(ctxOf("LAWYER")));
    expect(error.code).toBe("FORBIDDEN");
  });
});

describe("listas novas: página e total do período saem dos mesmos filtros", () => {
  it("extrato de recebimentos", async () => {
    repo.listReceiptStatement.mockResolvedValue({ rows: [], total: 0 });
    repo.receiptStatementTotals.mockResolvedValue({ count: 0, received: 0, deducted: 0, net: 0 });
    const out = await service.listReceiptStatement(admin, { page: 1, pageSize: 25, from: "2026-11-01", to: "2026-11-13", method: "PIX", q: "Maria", column: "occurred_at", ascending: false });
    const filters = { from: "2026-11-01", to: "2026-11-13", method: "PIX", kind: undefined, q: "Maria" };
    expect(repo.listReceiptStatement.mock.calls[0][1]).toEqual(filters);
    expect(repo.receiptStatementTotals.mock.calls[0][1]).toEqual(filters);
    expect(out).toMatchObject({ items: [], total: 0, page: 1, totals: { count: 0, net: 0 } });
  });

  it("a receber", async () => {
    repo.listReceivables.mockResolvedValue({ rows: [], total: 0 });
    repo.receivablesTotals.mockResolvedValue({ count: 0, total: 0, overdue: 0, overdue_count: 0, outside_totals: 0 });
    const out = await service.listReceivables(admin, { page: 1, pageSize: 25, overdueOnly: true, column: "due_date", ascending: true });
    const filters = { from: undefined, to: undefined, overdueOnly: true, q: undefined };
    expect(repo.listReceivables.mock.calls[0][1]).toEqual(filters);
    expect(repo.receivablesTotals.mock.calls[0][1]).toEqual(filters);
    expect(out.totals).toEqual({ count: 0, total: 0, overdue: 0, overdueCount: 0, outsideTotals: 0 });
  });
});
