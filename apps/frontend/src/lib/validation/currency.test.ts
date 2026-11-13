import { describe, expect, it } from "vitest";
import { parseCurrencyInput, readCurrencyInput, readPercentInput, zCurrencyOptional } from "./index";

describe("dinheiro digitado: formato brasileiro", () => {
  it("aceita milhar com ponto, centavos com vírgula, R$ e espaços", () => {
    const cases: [string, number][] = [
      ["1.234,56", 1234.56],
      ["1234,56", 1234.56],
      ["1234", 1234],
      ["1.500", 1500],
      ["1.234.567,8", 1234567.8],
      ["0,05", 0.05],
      ["R$ 1.234,56", 1234.56],
      [" 1 500,00 ", 1500],
      ["-10,00", -10],
    ];
    for (const [text, value] of cases) expect(readCurrencyInput(text), text).toEqual({ kind: "ok", value });
  });

  it("ponto como decimal é recusado com a orientação certa (antes, 1500.00 virava 150000)", () => {
    for (const text of ["1500.00", "2.5", "1.5", "1,234.56", "12.3456", "1.23.456"]) {
      const r = readCurrencyInput(text);
      expect(r, text).toMatchObject({ kind: "invalid", problem: "DOT_DECIMAL" });
      if (r.kind === "invalid") expect(r.message).toContain("Use vírgula para os centavos");
    }
  });

  it("texto que não é número é ERRO, nunca vazio", () => {
    for (const text of ["abc", "12a", "1,2,3", ",5", "12,", "--1", "1e3", "dez"]) {
      expect(readCurrencyInput(text).kind, text).toBe("invalid");
      expect(parseCurrencyInput(text), text).toBeUndefined();
    }
    expect(readCurrencyInput("10,255")).toMatchObject({ kind: "invalid", problem: "TOO_MANY_DECIMALS" });
  });

  it("vazio de propósito é vazio", () => {
    for (const text of ["", "   ", undefined, null]) expect(readCurrencyInput(text)).toEqual({ kind: "empty" });
    expect(readCurrencyInput("R$")).toEqual({ kind: "empty" });
  });

  it("parseCurrencyInput continua servindo os formulários que já validaram o campo", () => {
    expect(parseCurrencyInput("R$ 1.234,56")).toBe(1234.56);
    expect(parseCurrencyInput("1.500,50")).toBe(1500.5);
    expect(parseCurrencyInput("")).toBeUndefined();
    expect(parseCurrencyInput(undefined)).toBeUndefined();
    // Não multiplica mais por 100.
    expect(parseCurrencyInput("1500.00")).toBeUndefined();
  });

  it("zCurrencyOptional: vazio passa; ponto decimal e negativo têm mensagem própria", () => {
    const schema = zCurrencyOptional();
    expect(schema.safeParse("").success).toBe(true);
    expect(schema.safeParse(undefined).success).toBe(true);
    expect(schema.safeParse("1.234,56").success).toBe(true);
    const dot = schema.safeParse("1500.00");
    expect(dot.success).toBe(false);
    if (!dot.success) expect(dot.error.issues[0]?.message).toContain("Use vírgula para os centavos");
    const negative = schema.safeParse("-5,00");
    expect(negative.success).toBe(false);
    if (!negative.success) expect(negative.error.issues[0]?.message).toBe("Informe um valor maior ou igual a zero.");
    expect(schema.safeParse("abc").success).toBe(false);
  });
});

describe("percentual digitado: mesma disciplina", () => {
  it("aceita inteiro, vírgula e o sinal de %", () => {
    expect(readPercentInput("30")).toEqual({ kind: "ok", value: 30 });
    expect(readPercentInput("2,5")).toEqual({ kind: "ok", value: 2.5 });
    expect(readPercentInput("33,33 %")).toEqual({ kind: "ok", value: 33.33 });
    expect(readPercentInput("")).toEqual({ kind: "empty" });
  });

  it("2.5 é recusado (antes virava 25)", () => {
    const r = readPercentInput("2.5");
    expect(r).toMatchObject({ kind: "invalid", problem: "DOT_DECIMAL" });
    if (r.kind === "invalid") expect(r.message).toContain("Use vírgula para as casas decimais");
    expect(readPercentInput("trinta").kind).toBe("invalid");
  });
});
