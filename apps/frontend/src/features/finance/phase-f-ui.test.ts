import { describe, expect, it } from "vitest";
import { agreementListItemFromRows, balanceTotals, lastMonths, monthKey, monthlyNet, type AgreementListRow, type PaymentBalanceRow } from "@/server/domain/finance/mappers";
import { createAgreementSchema, createFeeModelSchema, listAgreementsSchema, updateFeeModelSchema } from "@/server/domain/finance/schemas";
import { agreementQueryFromSearchParams, agreementQueryToInput, agreementQueryToSearchParams, DEFAULT_AGREEMENT_QUERY } from "./list-query";
import { agreementCreateInput, feeModelCreateInput, feeModelPatch, feeModelToValues, feeTermsFromModel, moneyInput, occurredAtInput } from "./server-input";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const KEY = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

const balance = (over: Partial<PaymentBalanceRow>): PaymentBalanceRow => ({
  payment_id: UUID,
  financial_agreement_id: UUID,
  legal_case_id: UUID,
  amount: "100.00",
  currency: "BRL",
  due_date: "2026-11-01",
  received_amount: "0.00",
  balance: "100.00",
  last_receipt_at: null,
  status: "PENDING",
  ...over,
});

describe("totais do ledger — somados no servidor em centavos", () => {
  it("contratado ignora canceladas; em aberto e vencido só de abertas; recebido é líquido", () => {
    const t = balanceTotals([
      balance({ amount: "1000.10", received_amount: "400.05", balance: "600.05", status: "PARTIAL" }),
      balance({ amount: "300.00", received_amount: "0", balance: "300.00", status: "OVERDUE" }),
      balance({ amount: "200.00", received_amount: "200.00", balance: "0", status: "PAID" }),
      balance({ amount: "999.00", received_amount: "0", balance: "999.00", status: "CANCELLED" }),
    ]);
    expect(t).toEqual({ contracted: 1500.1, received: 600.05, outstanding: 900.05, overdue: 300, openPayments: 2 });
  });
  it("0,1 + 0,2 não vira 0,30000000000000004", () => {
    expect(balanceTotals([balance({ received_amount: "0.10" }), balance({ received_amount: "0.20" })]).received).toBe(0.3);
  });
  it("linha da lista: rótulos do caso (embed) e próximo vencimento só de aberta", () => {
    const row = {
      id: UUID,
      legal_case_id: UUID,
      fee_model_id: null,
      upfront_fee: null,
      fixed_fee: "1000",
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
      fee_models: { name: "Modelo A" },
      legal_cases: [{ title: "Caso X", origin_organization_id: UUID, clients: { individual_client_details: { full_name: "Maria Teste" }, company_client_details: null } }],
    } as AgreementListRow;
    const item = agreementListItemFromRows(row, [
      balance({ due_date: "2026-12-01" }),
      balance({ due_date: "2026-11-01", status: "PAID", balance: "0", received_amount: "100" }),
      balance({ due_date: "2026-11-15", status: "OVERDUE" }),
      balance({ financial_agreement_id: "other", due_date: "2026-01-01" }),
    ]);
    expect(item).toMatchObject({ caseTitle: "Caso X", clientName: "Maria Teste", feeModelName: "Modelo A", nextDueDate: "2026-11-15" });
    expect(item.totals.openPayments).toBe(2);
  });
});

describe("recebido por mês — fuso de São Paulo", () => {
  it("lançamento às 01h UTC do dia 1º ainda é do mês anterior em SP", () => {
    expect(monthKey("2026-11-01T01:00:00Z")).toBe("2026-10");
    expect(monthKey("2026-11-01T04:00:00Z")).toBe("2026-11");
  });
  it("12 meses do mais antigo ao atual; estorno subtrai; fora da janela é ignorado", () => {
    const months = lastMonths(new Date("2026-10-13T15:00:00Z"), 12);
    expect(months[0]).toBe("2025-11");
    expect(months[11]).toBe("2026-10");
    const data = monthlyNet(
      [
        { amount: "500.00", occurred_at: "2026-10-05T15:00:00Z" },
        { amount: "-100.00", occurred_at: "2026-10-06T15:00:00Z" },
        { amount: "50.00", occurred_at: "2024-01-01T15:00:00Z" },
      ],
      months,
    );
    expect(data.at(-1)).toEqual({ month: "2026-10", amount: 400 });
    expect(data.reduce((s, d) => s + d.amount, 0)).toBe(400);
  });
});

describe("formulários do financeiro → schemas reais", () => {
  it("modelo: vazio = ausente na criação, null no PATCH; moeda e percentual em pt-BR", () => {
    const values = { ...feeModelToValues(), name: " Bancário A ", fixedFee: "1.500,50", installments: "3", successFeePercent: "30" };
    const create = createFeeModelSchema.parse(feeModelCreateInput(values));
    expect(create).toMatchObject({ name: "Bancário A", fixedFee: 1500.5, installments: 3, successFeePercent: 30 });
    expect(create.upfrontFee).toBeUndefined();
    const patch = updateFeeModelSchema.parse({ id: UUID, patch: feeModelPatch(values) });
    expect(patch.patch.upfrontFee).toBeNull();
  });
  it("acordo: sem termos e com modelo → o servidor copia do modelo; chave obrigatória; nunca moeda nem organização", () => {
    const input = agreementCreateInput(UUID, { feeModelId: UUID, startDate: "", notes: "", activate: true, ...feeTermsFromModel(undefined) });
    expect(Object.keys(input)).not.toContain("currency");
    expect(createAgreementSchema.safeParse(input).success).toBe(false);
    expect(createAgreementSchema.parse({ ...input, idempotencyKey: KEY })).toMatchObject({ feeModelId: UUID, activate: true });
  });
  it("valores do modelo voltam formatados para o campo", () => {
    expect(moneyInput(1500.5)).toBe("1.500,50");
    expect(feeTermsFromModel({ upfrontFee: undefined, fixedFee: 1000, installments: 2, monthlyFee: undefined, successFeePercent: 12.5 })).toMatchObject({ fixedFee: "1.000,00", installments: "2", successFeePercent: "12,5" });
    expect(occurredAtInput("2026-10-13")).toBe("2026-10-13T12:00:00-03:00");
  });
  it("lista de contratos: situação e página na URL; entrada no schema real", () => {
    const q = { status: "ACTIVE" as const, page: 2 };
    expect(agreementQueryFromSearchParams(Object.fromEntries(agreementQueryToSearchParams(q)))).toEqual(q);
    expect(agreementQueryFromSearchParams({ situacao: "X" })).toEqual(DEFAULT_AGREEMENT_QUERY);
    expect(listAgreementsSchema.parse(agreementQueryToInput(q, { legalCaseId: UUID }))).toMatchObject({ status: "ACTIVE", legalCaseId: UUID, column: "created_at" });
  });
});
