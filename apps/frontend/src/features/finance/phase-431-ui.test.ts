import { describe, expect, it } from "vitest";
import { agreementShareFromRows, compositionByFeeModel, NO_FEE_MODEL_LABEL, shareTransfersFromRows } from "@/server/domain/finance/mappers";
import { createPaymentScheduleSchema } from "@/server/domain/finance/schemas";
import { previewSchedule, scheduleAmountsCents, scheduleDueDate } from "./schedule";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

describe("cronograma de parcelas — prévia igual à regra do banco (035)", () => {
  // Mesmos exemplos da seção [035] do verificador (supabase/tests/verificar.mjs).
  it("R$ 100,00 em 3: 33,34 + 33,33 + 33,33; 12 de R$ 1.000,00: quatro de 83,34 e oito de 83,33; soma exata", () => {
    expect(scheduleAmountsCents(100, 3)).toEqual([3334, 3333, 3333]);
    const twelve = scheduleAmountsCents(1000, 12)!;
    expect([twelve.filter((c) => c === 8334).length, twelve.filter((c) => c === 8333).length]).toEqual([4, 8]);
    expect(twelve.reduce((a, c) => a + c, 0)).toBe(100000);
    expect(scheduleAmountsCents(750.55, 1)).toEqual([75055]);
    // Sem float: 0,1 + 0,2 não vira 0,30000000000000004.
    expect(scheduleAmountsCents(0.3, 3)).toEqual([10, 10, 10]);
  });

  it("recusa o que o banco recusa: zero, fração de centavo, parcela abaixo de R$ 0,01, quantidade inválida", () => {
    expect(scheduleAmountsCents(0, 2)).toBeNull();
    expect(scheduleAmountsCents(100.005, 2)).toBeNull();
    expect(scheduleAmountsCents(0.02, 3)).toBeNull();
    expect(scheduleAmountsCents(100, 0)).toBeNull();
    expect(scheduleAmountsCents(100, 1.5)).toBeNull();
  });

  it("vencimentos: mensal preserva o dia quando o mês permite (31/01 → 28/02 → 31/03), virada de ano; quinzenal e semanal", () => {
    expect([1, 2, 3].map((i) => scheduleDueDate("2027-01-31", "MONTHLY", i))).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(scheduleDueDate("2027-11-30", "MONTHLY", 4)).toBe("2028-02-29");
    expect([1, 2, 3].map((i) => scheduleDueDate("2027-03-01", "BIWEEKLY", i))).toEqual(["2027-03-01", "2027-03-15", "2027-03-29"]);
    expect([1, 2, 3].map((i) => scheduleDueDate("2027-03-01", "WEEKLY", i))).toEqual(["2027-03-01", "2027-03-08", "2027-03-15"]);
  });

  it("prévia com descrição 'X i/N'; o schema nunca recebe lista de valores do navegador", () => {
    const p = previewSchedule({ total: 100, count: 3, firstDueDate: "2027-01-31", frequency: "MONTHLY", description: "Honorários" })!;
    expect(p.map((i) => [i.description, i.amount])).toEqual([
      ["Honorários 1/3", 33.34],
      ["Honorários 2/3", 33.33],
      ["Honorários 3/3", 33.33],
    ]);
    const parsed = createPaymentScheduleSchema.parse({ agreementId: UUID, idempotencyKey: UUID, total: 100, installments: 3, firstDueDate: "2027-01-31", frequency: "MONTHLY", amounts: [1, 2, 3] });
    expect(parsed).not.toHaveProperty("amounts");
    expect(createPaymentScheduleSchema.safeParse({ agreementId: UUID, idempotencyKey: UUID, total: 100, installments: 121, firstDueDate: "2027-01-31", frequency: "MONTHLY" }).success).toBe(false);
  });
});

describe("contratado por modelo (035)", () => {
  it("maior para menor; sem modelo com rótulo próprio; acima de 5, quatro + 'Outros'; centavos exatos", () => {
    const rows = [
      { fee_model_id: "a", fee_model_name: "Revisional", agreement_count: 3, contracted_amount: "3000.10" },
      { fee_model_id: null, fee_model_name: null, agreement_count: 1, contracted_amount: "500.00" },
      { fee_model_id: "b", fee_model_name: "Consultivo", agreement_count: 2, contracted_amount: "1200.00" },
    ];
    expect(compositionByFeeModel(rows).map((p) => [p.name, p.total, p.count])).toEqual([
      ["Revisional", 3000.1, 3],
      ["Consultivo", 1200, 2],
      [NO_FEE_MODEL_LABEL, 500, 1],
    ]);
    const many = Array.from({ length: 7 }, (_, i) => ({ fee_model_id: `m${i}`, fee_model_name: `M${i}`, agreement_count: 1, contracted_amount: String((7 - i) * 100.1) }));
    const out = compositionByFeeModel(many);
    expect(out.map((p) => p.name)).toEqual(["M0", "M1", "M2", "M3", "Outros"]);
    expect(out[4]).toMatchObject({ total: 600.6, count: 3, feeModelId: null });
  });
});

describe("valores da parceria — só leitura, derivados (035)", () => {
  it("receita elegível vem da view; sem linha = 0; repasses do caso somados por repasse, mais recentes primeiro", () => {
    const agreement = { id: "cpa", legal_case_id: "case", partner_percentage: "40", effective_at: "2026-01-01T00:00:00Z", cancelled_at: null, legal_cases: { title: "Caso" } };
    const balance = { case_partnership_agreement_id: "cpa", net_partner_amount: "400", transferred_amount: "150", paid_amount: "100" };
    const share = agreementShareFromRows(agreement as never, [balance as never], [{ case_partnership_agreement_id: "cpa", eligible_revenue: "1000.00" }]);
    expect(share).toMatchObject({ eligibleRevenue: 1000, accruedAmount: 400, paidOutAmount: 100, pendingTransferAmount: 50, availableAmount: 250 });
    expect(agreementShareFromRows(agreement as never, [], []).eligibleRevenue).toBe(0);

    const t = (id: string, amount: string, created: string) => ({ transfer_id: id, amount, partner_transfers: { status: "PAID", created_at: created, paid_at: null, reference: null } });
    const transfers = shareTransfersFromRows([t("t1", "50.10", "2026-02-01"), t("t2", "30", "2026-03-01"), t("t1", "20.20", "2026-02-01")]);
    expect(transfers.map((x) => [x.transferId, x.amount])).toEqual([
      ["t2", 30],
      ["t1", 70.3],
    ]);
  });
});
