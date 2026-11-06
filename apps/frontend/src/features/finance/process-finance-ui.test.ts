import { describe, expect, it } from "vitest";
import { createExpenseSchema, createFeeModelSchema, listExpensesSchema, listProcessFinanceSchema, updateExpenseSchema, updateFeeModelSchema } from "@/server/domain/finance/schemas";
import {
  DEFAULT_EXPENSE_QUERY,
  DEFAULT_PROCESS_FINANCE_QUERY,
  expenseQueryFromSearchParams,
  expenseQueryToInput,
  expenseQueryToSearchParams,
  financeTabFromSearchParams,
  processFinanceQueryFromSearchParams,
  processFinanceQueryToInput,
  processFinanceQueryToSearchParams,
  withFinanceTab,
} from "./list-query";
import { processPickerOption } from "./process-label";
import {
  expenseCreateInput,
  expenseMissingFields,
  expensePatch,
  expenseToValues,
  feeBillingTypeOf,
  feeModelCreateInput,
  feeModelMissingFields,
  feeModelPatch,
  feeModelToValues,
  withBillingType,
} from "./server-input";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const params = (p: URLSearchParams) => Object.fromEntries(p);

describe("abas do Financeiro (?aba=)", () => {
  it("aba desconhecida cai na visão geral; a aba fica primeiro e some na padrão", () => {
    expect(financeTabFromSearchParams({ aba: "despesas" })).toBe("despesas");
    expect(financeTabFromSearchParams({ aba: "honorarios" })).toBe("visao-geral");
    expect(financeTabFromSearchParams({})).toBe("visao-geral");
    expect(withFinanceTab(new URLSearchParams({ pagina: "2" }), "contratos").toString()).toBe("aba=contratos&pagina=2");
    expect(withFinanceTab(new URLSearchParams({ pagina: "2" }), "visao-geral").toString()).toBe("pagina=2");
  });
});

describe("lista por processo ↔ URL ↔ schema real", () => {
  it("ida e volta pela URL; busca com dígitos (CNJ/CPF) não vai para a URL", () => {
    const q = { search: "Maria", filter: "OVERDUE" as const, sort: "net" as const, page: 3 };
    expect(processFinanceQueryFromSearchParams(params(processFinanceQueryToSearchParams(q)))).toEqual(q);
    expect(processFinanceQueryToSearchParams({ ...q, search: "0001234" }).has("busca")).toBe(false);
    expect(processFinanceQueryFromSearchParams({ busca: "123.456.789-00", mostrar: "x", ordem: "y" })).toEqual(DEFAULT_PROCESS_FINANCE_QUERY);
  });

  it("filtro vira um booleano do schema; título ordena A–Z, valores do maior para o menor", () => {
    const parsed = listProcessFinanceSchema.parse(processFinanceQueryToInput({ search: " 0001234 ", filter: "OPEN_EXPENSES", sort: "expenses", page: 2 }, { legalCaseId: UUID }));
    expect(parsed).toMatchObject({ q: "0001234", openExpensesOnly: true, legalCaseId: UUID, column: "expenses_total", ascending: false, page: 2 });
    expect(parsed.overdueOnly).toBeUndefined();
    expect(listProcessFinanceSchema.parse(processFinanceQueryToInput({ ...DEFAULT_PROCESS_FINANCE_QUERY, sort: "title", filter: "WITHOUT_AGREEMENT" }))).toMatchObject({ column: "display_title", ascending: true, withoutAgreement: true });
  });

  it("rótulo do seletor de processo: título, cliente e CNJ formatado", () => {
    expect(processPickerOption({ legalProcessId: UUID, title: "Revisional", clientName: "Maria", cnjNumber: "00012345620268260100" })).toEqual({
      id: UUID,
      label: "Revisional",
      description: "Maria · 0001234-56.2026.8.26.0100",
    });
    expect(processPickerOption({ legalProcessId: UUID, title: "", clientName: "", cnjNumber: undefined }).description).toBe("Sem número CNJ");
  });
});

describe("lista de despesas ↔ URL ↔ schema real", () => {
  it("ida e volta; valores inválidos caem no padrão", () => {
    const q = { category: "HEARING" as const, status: "OPEN" as const, page: 2 };
    expect(params(expenseQueryToSearchParams(q))).toEqual({ categoria: "HEARING", situacao: "a-pagar", pagina: "2" });
    expect(expenseQueryFromSearchParams(params(expenseQueryToSearchParams(q)))).toEqual(q);
    expect(expenseQueryFromSearchParams({ categoria: "LUNCH", situacao: "OPEN" })).toEqual(DEFAULT_EXPENSE_QUERY);
    expect(listExpensesSchema.parse(expenseQueryToInput(q, { processId: UUID }))).toMatchObject({ processId: UUID, category: "HEARING", status: "OPEN", column: "incurred_on" });
  });
});

describe("formulário de despesa → schemas reais", () => {
  it("nova: moeda pt-BR; sem 'já paga' não manda data de pagamento; caso nunca vai", () => {
    const values = { ...expenseToValues(undefined, "2026-10-10"), category: "COURT_COSTS" as const, description: " Custas ", amount: "1.234,56", supplier: " " };
    const input = expenseCreateInput(UUID, values);
    expect(input).not.toHaveProperty("legalCaseId");
    expect(createExpenseSchema.parse(input)).toEqual({ processId: UUID, category: "COURT_COSTS", description: "Custas", amount: 1234.56, incurredOn: "2026-10-10", reimbursable: false });
    expect(createExpenseSchema.parse(expenseCreateInput(UUID, { ...values, paid: true, paidOn: "2026-10-10" })).paidOn).toBe("2026-10-10");
  });

  it("PATCH: desmarcar 'já paga' volta para a pagar (null); vazio limpa", () => {
    const patch = updateExpenseSchema.parse({ id: UUID, patch: expensePatch({ ...expenseToValues(undefined, "2026-10-10"), category: "OTHER", description: "x", amount: "10", paid: false }) }).patch;
    expect(patch).toMatchObject({ paidOn: null, supplier: null, notes: null, amount: 10 });
  });

  it("conferência de UX: categoria, descrição, valor > 0, data; pagamento exige data", () => {
    const empty = expenseToValues(undefined, "");
    expect(Object.keys(expenseMissingFields(empty)).sort()).toEqual(["amount", "category", "description", "incurredOn"]);
    expect(expenseMissingFields({ ...empty, category: "OTHER", description: "x", amount: "0,00", incurredOn: "2026-10-01" })).toHaveProperty("amount");
    expect(expenseMissingFields({ ...empty, category: "OTHER", description: "x", amount: "1", incurredOn: "2026-10-01", paid: true, paidOn: "" })).toEqual({ paidOn: "Informe a data do pagamento." });
  });
});

describe("modelo de honorários: tipo de cobrança primeiro", () => {
  it("o tipo é reconhecido pelos valores gravados; combinação fora dos tipos = personalizado", () => {
    expect(feeBillingTypeOf(undefined)).toBe("SUCCESS");
    expect(feeBillingTypeOf({ successFeePercent: 30 })).toBe("SUCCESS");
    expect(feeBillingTypeOf({ fixedFee: 1000 })).toBe("FIXED");
    expect(feeBillingTypeOf({ fixedFee: 1000, installments: 1 })).toBe("FIXED");
    expect(feeBillingTypeOf({ fixedFee: 3000, installments: 3 })).toBe("INSTALLMENTS");
    expect(feeBillingTypeOf({ monthlyFee: 500 })).toBe("MONTHLY");
    expect(feeBillingTypeOf({ upfrontFee: 1000, successFeePercent: 20 })).toBe("UPFRONT_SUCCESS");
    expect(feeBillingTypeOf({ fixedFee: 1000, successFeePercent: 20 })).toBe("CUSTOM");
    expect(feeBillingTypeOf({ installments: 3 })).toBe("CUSTOM");
  });

  it("salvar limpa os valores de outros tipos (ausente na criação, null no PATCH)", () => {
    const base = { ...feeModelToValues(), name: "Êxito 30", fixedFee: "1.000,00", installments: "3", successFeePercent: "30", upfrontFee: "500,00" };
    const create = createFeeModelSchema.parse(feeModelCreateInput({ ...base, billingType: "SUCCESS" }));
    expect(create).toMatchObject({ successFeePercent: 30 });
    expect(create.fixedFee).toBeUndefined();
    expect(create.upfrontFee).toBeUndefined();
    const patch = updateFeeModelSchema.parse({ id: UUID, patch: feeModelPatch({ ...base, billingType: "INSTALLMENTS" }) }).patch;
    expect(patch).toMatchObject({ fixedFee: 1000, installments: 3, successFeePercent: null, upfrontFee: null, monthlyFee: null });
  });

  it("trocar o tipo ajusta o momento da cobrança ao que o tipo permite", () => {
    const v = feeModelToValues();
    expect(v.billingMoment).toBe("ON_SUCCESS");
    expect(withBillingType(v, "MONTHLY").billingMoment).toBe("MONTHLY");
    expect(withBillingType({ ...v, billingMoment: "ON_FILING" }, "FIXED").billingMoment).toBe("ON_FILING");
    expect(withBillingType({ ...v, billingMoment: "ON_FILING" }, "UPFRONT_SUCCESS").billingMoment).toBe("ON_SIGNING");
  });

  it("cada tipo exige os seus valores", () => {
    const v = { ...feeModelToValues(), name: "M" };
    expect(feeModelMissingFields({ ...v, billingType: "SUCCESS" })).toHaveProperty("successFeePercent");
    expect(feeModelMissingFields({ ...v, billingType: "INSTALLMENTS", fixedFee: "1.000,00", installments: "1" })).toEqual({ installments: "Parcelado tem 2 parcelas ou mais." });
    expect(feeModelMissingFields({ ...v, billingType: "UPFRONT_SUCCESS", upfrontFee: "100", successFeePercent: "20" })).toEqual({});
    expect(feeModelMissingFields({ ...v, name: " ", billingType: "CUSTOM" })).toEqual({ name: "Informe o nome do modelo." });
  });
});
