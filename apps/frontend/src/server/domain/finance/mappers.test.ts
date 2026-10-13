import { describe, expect, it } from "vitest";
import {
  agreementInsert,
  agreementShareFromRows,
  agreementUpdate,
  allocationFromRow,
  feeModelUpdate,
  money,
  partnershipInternalFromRow,
  partnershipPartnerFromRow,
  paymentFromRows,
  receiptFromRow,
  shareTotals,
  transferInternalFromRow,
  transferPartnerFromRow,
  type AllocationBalanceRow,
  type PartnershipRow,
  type TransferRow,
} from "./mappers";
import { createAgreementSchema } from "./schemas";

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
  it("acordo: status decidido pelo service, autor da sessão; chaves ausentes não viram coluna; a chave de idempotência é gravada pelo repositório", () => {
    const input = createAgreementSchema.parse({ legalCaseId: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01", fixedFee: 1200, activate: true, idempotencyKey: "9b2d4c6e-1a3f-4e5b-8c7d-0f1e2d3c4b5a" });
    expect(agreementInsert(input, "actor-1")).toEqual({
      legal_case_id: "5f0c7a52-3c2b-4c1e-9d1a-2b0f2f6f9a01",
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
