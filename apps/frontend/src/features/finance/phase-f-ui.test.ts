import { describe, expect, it } from "vitest";
import { lastMonths, monthKey } from "@/server/domain/finance/mappers";
import { createAgreementSchema, createFeeModelSchema, listAgreementRowsSchema, updateFeeModelSchema } from "@/server/domain/finance/schemas";
import { agreementQueryFromSearchParams, agreementQueryIsFiltered, agreementQueryToInput, agreementQueryToSearchParams, DEFAULT_AGREEMENT_QUERY } from "./list-query";
import { agreementCreateInput, feeModelCreateInput, feeModelPatch, feeModelToValues, feeTermsFromModel, moneyInput, occurredAtInput } from "./server-input";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const KEY = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";

describe("meses da visão geral — fuso de São Paulo", () => {
  it("lançamento às 01h UTC do dia 1º ainda é do mês anterior em SP", () => {
    expect(monthKey("2026-11-01T01:00:00Z")).toBe("2026-10");
    expect(monthKey("2026-11-01T04:00:00Z")).toBe("2026-11");
  });
  it("12 meses do mais antigo ao atual (as despesas usam a mesma janela do recebido por mês, que agora vem somado do banco)", () => {
    const months = lastMonths(new Date("2026-10-13T15:00:00Z"), 12);
    expect(months[0]).toBe("2025-11");
    expect(months[11]).toBe("2026-10");
  });
});

describe("formulários do financeiro → schemas reais", () => {
  it("modelo: vazio = ausente na criação, null no PATCH; moeda e percentual em pt-BR", () => {
    // Combinação livre (modelo antigo): todos os valores valem.
    const values = { ...feeModelToValues(), billingType: "CUSTOM" as const, name: " Bancário A ", fixedFee: "1.500,50", installments: "3", successFeePercent: "30" };
    const create = createFeeModelSchema.parse(feeModelCreateInput(values));
    expect(create).toMatchObject({ name: "Bancário A", fixedFee: 1500.5, installments: 3, successFeePercent: 30 });
    expect(create.upfrontFee).toBeUndefined();
    const patch = updateFeeModelSchema.parse({ id: UUID, patch: feeModelPatch(values) });
    expect(patch.patch.upfrontFee).toBeNull();
  });
  it("acordo: sem termos e com modelo → o servidor copia do modelo; chave obrigatória; nunca moeda nem organização; é do processo (046)", () => {
    const input = agreementCreateInput(UUID, { feeModelId: UUID, startDate: "", notes: "", activate: true, ...feeTermsFromModel(undefined) });
    expect(Object.keys(input)).not.toContain("currency");
    expect(input).toMatchObject({ legalProcessId: UUID });
    expect(Object.keys(input)).not.toContain("legalCaseId");
    expect(createAgreementSchema.safeParse(input).success).toBe(false);
    expect(createAgreementSchema.parse({ ...input, idempotencyKey: KEY })).toMatchObject({ feeModelId: UUID, activate: true });
  });
  it("valores do modelo voltam formatados para o campo", () => {
    expect(moneyInput(1500.5)).toBe("1.500,50");
    expect(feeTermsFromModel({ upfrontFee: undefined, fixedFee: 1000, installments: 2, monthlyFee: undefined, successFeePercent: 12.5 })).toMatchObject({ fixedFee: "1.000,00", installments: "2", successFeePercent: "12,5" });
    expect(occurredAtInput("2026-10-13")).toBe("2026-10-13T12:00:00-03:00");
  });
});

describe("lista de contratos ↔ URL ↔ schema real (busca, período e vencimento no servidor)", () => {
  it("ida e volta de todos os filtros; valores inválidos caem no padrão", () => {
    const q = { status: "ACTIVE" as const, search: "Maria", periodFrom: "2026-01-01", periodTo: "2026-06-30", dueFrom: "2026-11-01", dueTo: "2026-11-30", page: 2 };
    expect(agreementQueryFromSearchParams(Object.fromEntries(agreementQueryToSearchParams(q)))).toEqual(q);
    expect(agreementQueryFromSearchParams({ situacao: "X", de: "2026-02-30", ate: "amanhã", "vence-de": "01/11/2026" })).toEqual(DEFAULT_AGREEMENT_QUERY);
    expect(agreementQueryIsFiltered(DEFAULT_AGREEMENT_QUERY)).toBe(false);
    expect(agreementQueryIsFiltered({ ...DEFAULT_AGREEMENT_QUERY, dueTo: "2026-11-30" })).toBe(true);
  });
  it("busca com dígitos (CNJ, CPF colado por engano) não vai para a URL, mas vai para o servidor", () => {
    const q = { ...DEFAULT_AGREEMENT_QUERY, search: "0001234-56.2026" };
    expect(agreementQueryToSearchParams(q).has("busca")).toBe(false);
    expect(agreementQueryToInput(q)).toMatchObject({ q: "0001234-56.2026" });
  });
  it("entrada no schema real: sem filtro de vencimento, mais recentes primeiro; com ele, pelo próximo vencimento", () => {
    const plain = listAgreementRowsSchema.parse(agreementQueryToInput({ ...DEFAULT_AGREEMENT_QUERY, status: "ACTIVE", page: 2 }, { legalCaseId: UUID }));
    expect(plain).toMatchObject({ status: "ACTIVE", legalCaseId: UUID, page: 2, column: "created_at", ascending: false });
    expect(plain.q).toBeUndefined();
    const due = listAgreementRowsSchema.parse(agreementQueryToInput({ ...DEFAULT_AGREEMENT_QUERY, search: " Maria ", periodFrom: "2026-01-01", dueFrom: "2026-11-01", dueTo: "2026-11-30" }));
    expect(due).toMatchObject({ q: "Maria", periodFrom: "2026-01-01", dueFrom: "2026-11-01", dueTo: "2026-11-30", column: "next_due_date", ascending: true });
  });
  it("o servidor recusa período ao contrário, data que não existe e ordenação fora da lista", () => {
    expect(listAgreementRowsSchema.safeParse({ periodFrom: "2026-06-30", periodTo: "2026-01-01" }).success).toBe(false);
    expect(listAgreementRowsSchema.safeParse({ dueFrom: "2026-12-01", dueTo: "2026-11-01" }).success).toBe(false);
    expect(listAgreementRowsSchema.safeParse({ dueFrom: "2026-02-30" }).success).toBe(false);
    expect(listAgreementRowsSchema.safeParse({ sortBy: "contracted; drop table" }).success).toBe(false);
    expect(listAgreementRowsSchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });
});
