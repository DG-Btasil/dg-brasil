import { describe, expect, it } from "vitest";
import { availableHint, receiptRemaining } from "./receipts";

describe("recebimento já estornado (F5)", () => {
  it("desconta estornos e ajustes para menos do recebimento a que apontam", () => {
    const r = receiptRemaining([
      { id: "a", amount: 500 },
      { id: "b", amount: 300 },
      { id: "c", amount: -500, originalReceiptId: "a" },
      { id: "d", amount: -100.5, originalReceiptId: "b" },
      { id: "e", amount: 50 },
    ]);
    expect(r.get("a")).toBe(0);
    expect(r.get("b")).toBe(199.5);
    expect(r.get("e")).toBe(50);
    expect(r.has("c")).toBe(false);
  });
});

describe("legenda do Disponível do parceiro (sugestão)", () => {
  it("segue o estado: a mais, em repasse, pronto ou nada", () => {
    expect(availableHint(-10, 0)).toMatch(/a mais/);
    expect(availableHint(0, 300)).toBe("Tudo já está em repasse");
    expect(availableHint(120, 300)).toBe("Além do que já está em repasse");
    expect(availableHint(120, 0)).toBe("Pronto para repassar");
    expect(availableHint(0, 0)).toBe("Nada a repassar agora");
  });
});
