import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { occurredAtInput } from "@/features/finance/server-input";
import {
  createExpenseSchema,
  listReceiptStatementSchema,
  listReceivablesSchema,
  markTransferPaidSchema,
  pastInstant,
  registerAdjustmentSchema,
  registerReceiptSchema,
  registerReversalSchema,
  reopenAgreementSchema,
  saoPauloDate,
  todaySaoPaulo,
} from "./schemas";

/** Correções da revisão final (064): regras de entrada, sem banco. */

const ID = "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01";
const KEY = "9b2d4c6e-1a3f-4e5b-8c7d-0f1e2d3c4b5a";

/** As três operações do livro que levam data + o pagamento do repasse: todas pela mesma regra. */
const withDate = (occurredAt: string) => ({
  recebimento: registerReceiptSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, occurredAt }).success,
  ajuste: registerAdjustmentSchema.safeParse({ idempotencyKey: KEY, paymentId: ID, direction: "DECREASE", amount: 5, justification: "Tarifa", originalReceiptId: ID, occurredAt }).success,
  estorno: registerReversalSchema.safeParse({ idempotencyKey: KEY, originalReceiptId: ID, occurredAt }).success,
  repassePago: markTransferPaidSchema.safeParse({ id: ID, paidAt: occurredAt }).success,
});
const all = (ok: boolean) => ({ recebimento: ok, ajuste: ok, estorno: ok, repassePago: ok });

describe("data do lançamento: vale o DIA em São Paulo, não o instante", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("09h de São Paulo: a data de HOJE é aceita (antes das 11h55 era recusada: o formulário manda meio-dia)", () => {
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z")); // 09h em São Paulo
    expect(todaySaoPaulo()).toBe("2026-11-13");
    expect(withDate(occurredAtInput("2026-11-13")!)).toEqual(all(true));
    expect(withDate(occurredAtInput("2026-11-12")!)).toEqual(all(true));
    expect(withDate(occurredAtInput("2026-11-14")!)).toEqual(all(false));
  });

  it("23h de São Paulo (já é o dia seguinte em UTC): hoje vale, amanhã não", () => {
    vi.setSystemTime(new Date("2026-11-14T02:00:00Z")); // 23h do dia 13 em São Paulo
    expect(todaySaoPaulo()).toBe("2026-11-13");
    expect(withDate(occurredAtInput("2026-11-13")!)).toEqual(all(true));
    // Em UTC "hoje" já é dia 14: não pode vazar para a regra.
    expect(withDate(occurredAtInput("2026-11-14")!)).toEqual(all(false));
    expect(withDate("2026-11-14T01:59:00Z")).toEqual(all(true));
  });

  it("00h30 de São Paulo: o dia que acabou de começar vale; o instante gravado nunca fica no futuro", () => {
    vi.setSystemTime(new Date("2026-11-14T03:30:00Z")); // 00h30 do dia 14 em São Paulo
    expect(withDate(occurredAtInput("2026-11-14")!)).toEqual(all(true));
    expect(pastInstant(occurredAtInput("2026-11-14"))).toBe("2026-11-14T03:30:00.000Z");
  });

  it("o instante gravado: hoje de manhã vale o agora; à noite e em dias passados, o meio-dia informado", () => {
    vi.setSystemTime(new Date("2026-11-13T12:00:00Z")); // 09h
    expect(pastInstant(occurredAtInput("2026-11-13"))).toBe("2026-11-13T12:00:00.000Z");
    expect(pastInstant(occurredAtInput("2026-11-10"))).toBe("2026-11-10T12:00:00-03:00");
    expect(pastInstant(undefined)).toBeUndefined();
    vi.setSystemTime(new Date("2026-11-14T02:00:00Z")); // 23h
    expect(pastInstant(occurredAtInput("2026-11-13"))).toBe("2026-11-13T12:00:00-03:00");
  });

  it("data civil de São Paulo de um instante", () => {
    expect(saoPauloDate(new Date("2026-11-14T02:59:59Z"))).toBe("2026-11-13");
    expect(saoPauloDate(new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-14");
  });
});

describe("ajuste para menos exige o recebimento corrigido", () => {
  const base = { idempotencyKey: KEY, paymentId: ID, amount: 50, justification: "Tarifa bancária" };

  it("para menos sem original: erro no campo, com a orientação", () => {
    const r = registerAdjustmentSchema.safeParse({ ...base, direction: "DECREASE" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join(".") === "originalReceiptId");
      expect(issue?.message).toBe("Escolha o recebimento que este ajuste corrige.");
    }
  });

  it("para menos com original e para mais sem original passam", () => {
    expect(registerAdjustmentSchema.safeParse({ ...base, direction: "DECREASE", originalReceiptId: ID }).success).toBe(true);
    expect(registerAdjustmentSchema.safeParse({ ...base, direction: "INCREASE" }).success).toBe(true);
  });
});

describe("reabrir contrato", () => {
  it("exige o motivo (até 500 caracteres)", () => {
    expect(reopenAgreementSchema.safeParse({ id: ID }).success).toBe(false);
    expect(reopenAgreementSchema.safeParse({ id: ID, reason: "   " }).success).toBe(false);
    expect(reopenAgreementSchema.safeParse({ id: ID, reason: "x".repeat(501) }).success).toBe(false);
    expect(reopenAgreementSchema.parse({ id: ID, reason: " Pix devolvido " })).toEqual({ id: ID, reason: "Pix devolvido" });
  });
});

describe("extrato de recebimentos e a receber: filtros conferidos no servidor", () => {
  it("extrato: período, forma, tipo e busca; padrão = mais recentes primeiro", () => {
    expect(listReceiptStatementSchema.parse({ from: "2026-11-01", to: "2026-11-13", method: "PIX", kind: "RECEIPT", q: " Maria " })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-13",
      method: "PIX",
      kind: "RECEIPT",
      q: "Maria",
      page: 1,
      pageSize: 25,
      column: "occurred_at",
      ascending: false,
    });
    expect(listReceiptStatementSchema.safeParse({ from: "2026-11-13", to: "2026-11-01" }).success).toBe(false);
    expect(listReceiptStatementSchema.safeParse({ method: "BITCOIN" }).success).toBe(false);
    expect(listReceiptStatementSchema.safeParse({ kind: "REFUND" }).success).toBe(false);
    expect(listReceiptStatementSchema.safeParse({ sortBy: "client_name" }).success).toBe(false);
    expect(listReceiptStatementSchema.safeParse({ pageSize: 51 }).success).toBe(false);
  });

  it("a receber: vencimento, só vencidas e busca; padrão = vencimento mais antigo primeiro", () => {
    expect(listReceivablesSchema.parse({ from: "2026-11-01", to: "2026-11-30", overdueOnly: true })).toMatchObject({ from: "2026-11-01", to: "2026-11-30", overdueOnly: true, column: "due_date", ascending: true });
    expect(listReceivablesSchema.parse({})).toMatchObject({ page: 1, pageSize: 25, column: "due_date", ascending: true });
    expect(listReceivablesSchema.safeParse({ overdueOnly: "sim" }).success).toBe(false);
    expect(listReceivablesSchema.safeParse({ from: "2026-12-01", to: "2026-11-30" }).success).toBe(false);
    expect(listReceivablesSchema.safeParse({ from: "30/11/2026" }).success).toBe(false);
  });
});

describe("despesa com chave de idempotência", () => {
  it("toda despesa nova leva a chave do envio", () => {
    const base = { processId: ID, category: "COURT_COSTS", description: "Custas", amount: 100, incurredOn: "2026-10-01" };
    expect(createExpenseSchema.safeParse(base).success).toBe(false);
    expect(createExpenseSchema.safeParse({ ...base, idempotencyKey: "clique-1" }).success).toBe(false);
    expect(createExpenseSchema.parse({ ...base, idempotencyKey: KEY })).toMatchObject({ idempotencyKey: KEY, reimbursable: false });
  });
});
