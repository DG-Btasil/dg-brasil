import { describe, expect, it } from "vitest";
import { createFeeModelSchema, listReceiptStatementSchema, listReceivablesSchema } from "@/server/domain/finance/schemas";
import {
  DEFAULT_RECEIVABLE_QUERY,
  FINANCE_TABS,
  financeTabFromSearchParams,
  isoDateParam,
  monthStart,
  periodProblem,
  receiptStatementQueryFromSearchParams,
  receiptStatementQueryToInput,
  receiptStatementQueryToSearchParams,
  receivableQueryFromSearchParams,
  receivableQueryIsFiltered,
  receivableQueryToInput,
  receivableQueryToSearchParams,
} from "./list-query";
import { draftTotalsNotice, hasDraftTotals, hasOutsideTotals, outsideTotalsNotice } from "./outside-totals";
import { expenseMissingFields, expenseToValues, feeModelCreateInput, feeModelMissingFields, feeModelToValues, feeTermsErrors, feeTermsInput, moneyField } from "./server-input";

/** Correções da revisão final nas telas do Financeiro: valores digitados, listas novas e o aviso Home × Financeiro. */

const params = (p: URLSearchParams) => Object.fromEntries(p);
const noTerms = { upfrontFee: "", fixedFee: "", installments: "", monthlyFee: "", successFeePercent: "" };

describe("campo de dinheiro dos diálogos: inválido nunca vira 'em branco'", () => {
  it("vazio de propósito é vazio (quitar o saldo, estornar tudo)", () => {
    expect(moneyField("")).toEqual({});
    expect(moneyField("   ")).toEqual({});
    expect(moneyField(undefined)).toEqual({});
  });

  it("texto que não é número é ERRO (antes virava vazio e o recebimento quitava o saldo inteiro)", () => {
    for (const text of ["abc", "1500.00", "2.5", "10,255", "1,2,3"]) {
      const r = moneyField(text);
      expect(r.value, text).toBeUndefined();
      expect(r.error, text).toBeTruthy();
    }
    expect(moneyField("1500.00").error).toContain("Use vírgula para os centavos");
  });

  it("formato brasileiro vira número; zero e negativo são recusados", () => {
    expect(moneyField("1.500,00")).toEqual({ value: 1500 });
    expect(moneyField("R$ 1.234,56")).toEqual({ value: 1234.56 });
    expect(moneyField("0,00").error).toBe("Informe um valor maior que zero.");
    expect(moneyField("-5,00").error).toBe("Informe um valor maior que zero.");
  });

  it("campo obrigatório: vazio também é erro, com a mensagem do formulário", () => {
    expect(moneyField("", { required: true })).toEqual({ error: "Informe um valor maior que zero." });
    expect(moneyField("", { required: true, requiredMessage: "Informe um total maior que zero." }).error).toBe("Informe um total maior que zero.");
    expect(moneyField("10", { required: true })).toEqual({ value: 10 });
  });
});

describe("valores do contrato e do modelo: formato conferido antes de enviar", () => {
  it("percentual com ponto não vira dez vezes maior: é recusado com a orientação", () => {
    expect(feeTermsInput({ ...noTerms, successFeePercent: "2,5" }).successFeePercent).toBe(2.5);
    expect(feeTermsInput({ ...noTerms, successFeePercent: "30%" }).successFeePercent).toBe(30);
    // Antes: "2.5" virava 25.
    expect(feeTermsInput({ ...noTerms, successFeePercent: "2.5" }).successFeePercent).toBeUndefined();
    expect(feeTermsErrors({ ...noTerms, successFeePercent: "2.5" }).successFeePercent).toContain("Use vírgula para as casas decimais");
    expect(feeTermsErrors({ ...noTerms, successFeePercent: "130" }).successFeePercent).toBe("Informe um percentual entre 0 e 100.");
  });

  it("dinheiro com ponto, texto e parcelas quebradas têm erro no próprio campo; vazio e formato certo não", () => {
    const errors = feeTermsErrors({ upfrontFee: "1500.00", fixedFee: "mil", installments: "2,5", monthlyFee: "-1,00", successFeePercent: "" });
    expect(errors.upfrontFee).toContain("Use vírgula para os centavos");
    expect(errors.fixedFee).toBeTruthy();
    expect(errors.installments).toBe("Informe um número inteiro de parcelas.");
    expect(errors.monthlyFee).toBe("O valor não pode ser negativo.");
    expect(feeTermsErrors(noTerms)).toEqual({});
    expect(feeTermsErrors({ upfrontFee: "500,00", fixedFee: "1.500,50", installments: "3", monthlyFee: "", successFeePercent: "30" })).toEqual({});
  });

  it("modelo: valor do tipo digitado com ponto diz 'use vírgula', não 'informe o valor'; o que foi limpo pelo tipo não gera erro", () => {
    const base = { ...feeModelToValues(), name: "Fixo" };
    expect(feeModelMissingFields({ ...base, billingType: "FIXED", fixedFee: "1500.00" }).fixedFee).toContain("Use vírgula para os centavos");
    expect(feeModelMissingFields({ ...base, billingType: "SUCCESS", successFeePercent: "2.5" }).successFeePercent).toContain("Use vírgula para as casas decimais");
    // Valor de outro tipo (será limpo ao salvar) não trava o formulário.
    expect(feeModelMissingFields({ ...base, billingType: "SUCCESS", successFeePercent: "30", fixedFee: "1500.00" })).toEqual({});
    expect(feeModelMissingFields({ ...base, billingType: "CUSTOM", monthlyFee: "abc" }).monthlyFee).toBeTruthy();
    expect(createFeeModelSchema.parse(feeModelCreateInput({ ...base, billingType: "FIXED", fixedFee: "1.500,00" }))).toMatchObject({ fixedFee: 1500 });
  });

  it("despesa: valor com ponto tem a orientação certa", () => {
    const values = { ...expenseToValues(undefined, "2026-10-10"), category: "OTHER" as const, description: "x" };
    expect(expenseMissingFields({ ...values, amount: "1500.00" }).amount).toContain("Use vírgula para os centavos");
    expect(expenseMissingFields({ ...values, amount: "" }).amount).toBe("Informe um valor maior que zero.");
    expect(expenseMissingFields({ ...values, amount: "1.500,00" })).toEqual({});
  });
});

describe("abas e datas da URL", () => {
  it("as duas abas novas existem e a aba desconhecida cai na visão geral", () => {
    expect(FINANCE_TABS).toContain("a-receber");
    expect(FINANCE_TABS).toContain("recebimentos");
    expect(financeTabFromSearchParams({ aba: "a-receber" })).toBe("a-receber");
    expect(financeTabFromSearchParams({ aba: "exportar" })).toBe("visao-geral");
  });

  it("data da URL: só data civil que existe; período ao contrário é avisado", () => {
    expect(isoDateParam("2026-11-13")).toBe("2026-11-13");
    for (const bad of ["2026-02-30", "13/11/2026", "2026-11-13T00:00:00Z", "", undefined]) expect(isoDateParam(bad)).toBe("");
    expect(periodProblem("2026-11-13", "2026-11-01")).toBe("A data inicial não pode ser depois da final.");
    expect(periodProblem("2026-11-01", "2026-11-13")).toBeUndefined();
    expect(periodProblem("", "2026-11-13")).toBeUndefined();
  });
});

describe("a receber ↔ URL ↔ schema real", () => {
  it("ida e volta; padrão sem filtro; vencimento mais antigo primeiro", () => {
    const q = { search: "Maria", from: "2026-11-01", to: "2026-11-30", overdueOnly: true, drafts: false, page: 3 };
    expect(params(receivableQueryToSearchParams(q))).toEqual({ busca: "Maria", de: "2026-11-01", ate: "2026-11-30", mostrar: "vencidas", pagina: "3" });
    expect(receivableQueryFromSearchParams(params(receivableQueryToSearchParams(q)))).toEqual(q);
    expect(receivableQueryFromSearchParams({ mostrar: "tudo", de: "ontem" })).toEqual(DEFAULT_RECEIVABLE_QUERY);
    expect(receivableQueryIsFiltered(DEFAULT_RECEIVABLE_QUERY)).toBe(false);
    expect(receivableQueryIsFiltered({ ...DEFAULT_RECEIVABLE_QUERY, overdueOnly: true })).toBe(true);
    expect(listReceivablesSchema.parse(receivableQueryToInput(q))).toMatchObject({ q: "Maria", from: "2026-11-01", to: "2026-11-30", overdueOnly: true, page: 3, column: "due_date", ascending: true });
    expect(listReceivablesSchema.parse(receivableQueryToInput(DEFAULT_RECEIVABLE_QUERY)).overdueOnly).toBeUndefined();
    // F1: contratos em rascunho numa lista à parte, que também vai para a URL.
    const drafts = { ...DEFAULT_RECEIVABLE_QUERY, drafts: true };
    expect(params(receivableQueryToSearchParams(drafts))).toEqual({ contratos: "rascunho" });
    expect(receivableQueryFromSearchParams({ contratos: "rascunho" })).toEqual(drafts);
    expect(listReceivablesSchema.parse(receivableQueryToInput(drafts)).drafts).toBe(true);
  });
});

describe("extrato de recebimentos ↔ URL ↔ schema real", () => {
  const TODAY = "2026-11-13";

  it("sem período na URL, abre no mês corrente (de 1º até hoje)", () => {
    expect(monthStart(TODAY)).toBe("2026-11-01");
    expect(receiptStatementQueryFromSearchParams({}, TODAY)).toEqual({ search: "", from: "2026-11-01", to: "2026-11-13", method: "", kind: "", page: 1 });
  });

  it("período escolhido vale como veio; 'todo o período' (datas vazias) é uma escolha e fica na URL", () => {
    const q = { search: "", from: "2026-10-01", to: "2026-10-31", method: "PIX" as const, kind: "REVERSAL" as const, page: 2 };
    expect(params(receiptStatementQueryToSearchParams(q))).toEqual({ de: "2026-10-01", ate: "2026-10-31", forma: "PIX", tipo: "estornos", pagina: "2" });
    expect(receiptStatementQueryFromSearchParams(params(receiptStatementQueryToSearchParams(q)), TODAY)).toEqual(q);
    const all = { search: "", from: "", to: "", method: "" as const, kind: "" as const, page: 1 };
    expect(params(receiptStatementQueryToSearchParams(all))).toEqual({ de: "", ate: "" });
    expect(receiptStatementQueryFromSearchParams(params(receiptStatementQueryToSearchParams(all)), TODAY)).toEqual(all);
  });

  it("entrada no schema real: mais recentes primeiro; forma e tipo inválidos da URL são ignorados", () => {
    const q = receiptStatementQueryFromSearchParams({ de: "2026-10-01", ate: "2026-10-31", forma: "BITCOIN", tipo: "pix", busca: "Maria" }, TODAY);
    expect(q).toMatchObject({ method: "", kind: "", search: "Maria" });
    expect(listReceiptStatementSchema.parse(receiptStatementQueryToInput(q))).toMatchObject({ from: "2026-10-01", to: "2026-10-31", q: "Maria", column: "occurred_at", ascending: false });
  });
});

describe("Home × Financeiro: o mesmo aviso, com os mesmos valores", () => {
  const zero = { contracted: 0, received: 0, outstanding: 0, overdue: 0, openPayments: 0 };

  it("sem contrato antigo nem de processo excluído, não há aviso", () => {
    expect(hasOutsideTotals(zero)).toBe(false);
  });

  it("com valores fora dos totais, o texto diz quanto e por quê", () => {
    const outside = { ...zero, contracted: 201, outstanding: 201, openPayments: 5 };
    expect(hasOutsideTotals(outside)).toBe(true);
    const text = outsideTotalsNotice(outside);
    expect(text).toContain("201,00");
    expect(text).toContain("contratos antigos, ligados só ao caso, ou de processos excluídos");
    expect(text).toContain("não entram nos totais");
  });
});

describe("contratos em rascunho fora do em aberto (F1)", () => {
  it("aviso igual na Home e no Financeiro, só quando há parcela em rascunho", () => {
    const zero = { contracted: 0, received: 0, outstanding: 0, overdue: 0, openPayments: 0 };
    expect(hasDraftTotals(zero)).toBe(false);
    const draft = { ...zero, outstanding: 1350.5, openPayments: 3 };
    expect(hasDraftTotals(draft)).toBe(true);
    expect(draftTotalsNotice(draft)).toMatch(/^Em contratos em rascunho: R\$\s?1\.350,50 \(3 parcelas\)/);
  });
});

