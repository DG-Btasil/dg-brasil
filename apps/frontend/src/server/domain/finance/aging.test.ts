import { describe, expect, it } from "vitest";
import { agingBucket, daysUntil, receivableAging, saoPauloToday, type AgingBalanceRow } from "./aging";

const row = (over: Partial<AgingBalanceRow> = {}): AgingBalanceRow => ({ financial_agreement_id: "ag-1", due_date: "2026-11-20", balance: "100.00", status: "PENDING", ...over });

describe("A receber por vencimento — data de hoje em São Paulo", () => {
  it("o dia vira à meia-noite de São Paulo, não de UTC", () => {
    expect(saoPauloToday(new Date("2026-11-09T15:00:00Z"))).toBe("2026-11-09");
    // 02h UTC do dia 10 ainda é dia 9 em SP (UTC−3).
    expect(saoPauloToday(new Date("2026-11-10T02:59:59Z"))).toBe("2026-11-09");
    expect(saoPauloToday(new Date("2026-11-10T03:00:00Z"))).toBe("2026-11-10");
  });

  it("dias corridos entre datas puras, atravessando mês e ano", () => {
    expect(daysUntil("2026-11-09", "2026-11-09")).toBe(0);
    expect(daysUntil("2026-11-08", "2026-11-09")).toBe(-1);
    expect(daysUntil("2026-12-09", "2026-11-09")).toBe(30);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });
});

describe("A receber por vencimento — faixas", () => {
  const today = "2026-11-09";
  it("limites: vencida antes de hoje; hoje e +30 em 'até 30'; 31/60; 61/90; acima de 90", () => {
    expect(agingBucket("2026-11-08", today)).toBe("OVERDUE");
    expect(agingBucket("2026-11-09", today)).toBe("UP_TO_30");
    expect(agingBucket("2026-12-09", today)).toBe("UP_TO_30"); // +30
    expect(agingBucket("2026-12-10", today)).toBe("DAYS_31_60"); // +31
    expect(agingBucket("2027-01-08", today)).toBe("DAYS_31_60"); // +60
    expect(agingBucket("2027-01-09", today)).toBe("DAYS_61_90"); // +61
    expect(agingBucket("2027-02-07", today)).toBe("DAYS_61_90"); // +90
    expect(agingBucket("2027-02-08", today)).toBe("OVER_90"); // +91
    expect(agingBucket(null, today)).toBeNull();
  });

  it("soma em centavos por faixa, na ordem do gráfico, com quantidade e total", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const r = receivableAging(
      [
        row({ due_date: "2026-10-01", balance: "0.10", status: "OVERDUE" }),
        row({ due_date: "2026-10-15", balance: "0.20", status: "OVERDUE" }),
        row({ due_date: "2026-11-09", balance: "250.50", status: "PARTIAL" }),
        row({ due_date: "2027-03-01", balance: 1000 }),
        row({ due_date: null, balance: "40.00" }),
      ],
      now,
    );
    expect(r.buckets).toEqual([
      { bucket: "OVERDUE", amount: 0.3, count: 2 },
      { bucket: "UP_TO_30", amount: 250.5, count: 1 },
      { bucket: "DAYS_31_60", amount: 0, count: 0 },
      { bucket: "DAYS_61_90", amount: 0, count: 0 },
      { bucket: "OVER_90", amount: 1000, count: 1 },
    ]);
    expect(r.undated).toEqual({ amount: 40, count: 1 });
    expect(r.total).toBe(1290.8);
  });

  it("às 23h de São Paulo (02h UTC do dia seguinte) a obrigação que vence hoje ainda não está em atraso", () => {
    const r = receivableAging([row({ due_date: "2026-11-09" })], new Date("2026-11-10T02:00:00Z"));
    expect(r.buckets.find((b) => b.bucket === "UP_TO_30")?.amount).toBe(100);
    expect(r.buckets.find((b) => b.bucket === "OVERDUE")?.amount).toBe(0);
  });

  it("status OVERDUE do banco manda (igual ao indicador 'Em atraso')", () => {
    const r = receivableAging([row({ due_date: "2026-11-09", status: "OVERDUE" })], new Date("2026-11-09T15:00:00Z"));
    expect(r.buckets[0]).toEqual({ bucket: "OVERDUE", amount: 100, count: 1 });
  });

  it("fora: pagas, canceladas, saldo zero ou negativo e contratos antigos (sem processo)", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    const r = receivableAging(
      [
        row({ status: "PAID" }),
        row({ status: "CANCELLED" }),
        row({ balance: "0.00" }),
        row({ balance: "-5.00" }),
        row({ financial_agreement_id: "legado-do-caso" }),
        row({ financial_agreement_id: "ag-1", balance: "10.00" }),
      ],
      now,
      new Set(["ag-1"]),
    );
    expect(r.total).toBe(10);
    expect(r.buckets.find((b) => b.bucket === "UP_TO_30")).toEqual({ bucket: "UP_TO_30", amount: 10, count: 1 });
  });

  it("nada em aberto: todas as faixas zeradas (estado vazio na tela)", () => {
    const r = receivableAging([], new Date("2026-11-09T15:00:00Z"), new Set());
    expect(r.total).toBe(0);
    expect(r.buckets.every((b) => b.amount === 0 && b.count === 0)).toBe(true);
    expect(r.undated).toEqual({ amount: 0, count: 0 });
  });
});
