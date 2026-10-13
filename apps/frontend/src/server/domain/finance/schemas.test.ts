import { describe, expect, it } from "vitest";
import {
  cancelTransferSchema,
  createAgreementSchema,
  createPaymentSchema,
  createTransferSchema,
  listAllocationsSchema,
  listPaymentsSchema,
  listTransfersSchema,
  registerAdjustmentSchema,
  registerReceiptSchema,
  registerReversalSchema,
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
    expect(createAgreementSchema.safeParse({ legalCaseId: ID }).success).toBe(false);
    expect(createAgreementSchema.safeParse({ legalCaseId: ID, idempotencyKey: KEY }).success).toBe(true);
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
