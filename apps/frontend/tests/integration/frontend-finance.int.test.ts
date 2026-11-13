import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as cases from "@/server/domain/cases/service";
import { createCaseSchema } from "@/server/domain/cases/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import * as finance from "@/server/domain/finance/service";
import { createAgreementSchema, createPaymentSchema, listAgreementRowsSchema, registerReceiptSchema, registerReversalSchema } from "@/server/domain/finance/schemas";
import { ctxFor, expectDomainError, fakeCpf, world, processForCase } from "./support/world";
import { validPfClient } from "./support/fixtures";

/**
 * Etapa 4.3, Fase F — financeiro das telas no Supabase DEV real:
 * ciclo de vida do acordo garantido no BANCO (migration 030), lista de
 * contratos com totais do ledger e visão geral agregada no servidor.
 * Dados fictícios; nada sai do DEV.
 */

const key = () => randomUUID();

/** Caso interno novo (pelos services reais), para não disputar o "um ativo por caso" com outros testes. */
async function internalCase(title: string): Promise<string> {
  const admin = await ctxFor("ADMIN");
  const { id: clientId } = await clients.createClient(admin, createClientSchema.parse(validPfClient(fakeCpf(), { fullName: "Cliente Financeiro 030" })));
  const input = createCaseSchema.parse({ idempotencyKey: randomUUID(), clientId, area: "BANKING", title, originOrganizationId: world.owner });
  return (await cases.createCase(admin, input)).id;
}

let caseId = "";

beforeAll(async () => {
  caseId = await internalCase(`Caso financeiro 030 ${world.run}`);
});

describe("ciclo de vida do acordo (030)", () => {
  it("rascunho → ativo; termos congelam; concluir com aberta é recusado (inclusive direto no banco); quitada, conclui", async () => {
    const admin = await ctxFor("ADMIN");
    const { id } = await finance.createAgreement(admin, createAgreementSchema.parse({ idempotencyKey: key(), legalProcessId: await processForCase(caseId), fixedFee: 900 }));
    await finance.changeAgreementStatus(admin, { id, to: "ACTIVE" });
    const direct = await admin.db.from("financial_agreements").update({ fixed_fee: 1 }).eq("id", id);
    expect(direct.error?.message).toMatch(/Só o rascunho/);

    const p = await finance.createPayment(admin, createPaymentSchema.parse({ idempotencyKey: key(), agreementId: id, amount: 900, paymentType: "FIXED" }));
    // O TypeScript recusa antes; o banco também (UPDATE direto com o JWT do ADMIN).
    await expectDomainError(finance.changeAgreementStatus(admin, { id, to: "COMPLETED" }), "BUSINESS_RULE");
    const bypass = await admin.db.from("financial_agreements").update({ status: "COMPLETED" }).eq("id", id);
    expect(bypass.error?.message).toMatch(/parcelas em aberto/);

    const receipt = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId: p.id, method: "PIX" }));
    await finance.changeAgreementStatus(admin, { id, to: "COMPLETED" });
    expect((await finance.getAgreement(admin, id)).status).toBe("COMPLETED");

    // Concluído: sem parcela nova nem lançamento. Estorno exige REABRIR o contrato (064): no service e direto no banco.
    await expectDomainError(finance.createPayment(admin, createPaymentSchema.parse({ idempotencyKey: key(), agreementId: id, amount: 10, paymentType: "OTHER" })), "INVALID_STATE");
    const directPayment = await admin.db.from("payments").insert({ financial_agreement_id: id, amount: 10, payment_type: "OTHER" });
    expect(directPayment.error?.message).toMatch(/não recebe nem altera obrigações/);
    const reversal = registerReversalSchema.parse({ idempotencyKey: key(), originalReceiptId: receipt.receiptId, amount: 100 });
    await expectDomainError(finance.registerReversal(admin, reversal), "INVALID_STATE");
    const directReversal = await admin.db.from("payment_receipts").insert({ payment_id: p.id, kind: "REVERSAL", amount: -100, currency: "BRL", original_receipt_id: receipt.receiptId });
    expect(directReversal.error?.message).toMatch(/Reabra o contrato/);
    // Reabrir sem motivo (UPDATE direto) é recusado; com motivo, pelo service, volta a ativo.
    const directReopen = await admin.db.from("financial_agreements").update({ status: "ACTIVE" }).eq("id", id);
    expect(directReopen.error?.message).toMatch(/motivo para reabrir/);
    await expectDomainError(finance.reopenAgreement(await ctxFor("LAWYER"), { id, reason: "Tentativa" }), "FORBIDDEN");
    await finance.reopenAgreement(admin, { id, reason: "Pix devolvido (teste de integração)" });
    expect(await finance.getAgreement(admin, id)).toMatchObject({ status: "ACTIVE", reopenReason: "Pix devolvido (teste de integração)" });
    await finance.registerReversal(admin, reversal);
    expect((await finance.getPayment(admin, p.id)).receivedAmount).toBe(800);
    // Reaberto e com saldo: não conclui; recebido de novo, conclui outra vez.
    await expectDomainError(finance.changeAgreementStatus(admin, { id, to: "COMPLETED" }), "BUSINESS_RULE");
    await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId: p.id, method: "PIX" }));
    await finance.changeAgreementStatus(admin, { id, to: "COMPLETED" });
    expect((await finance.getAgreement(admin, id)).status).toBe("COMPLETED");
  });

  it("acordo concluído ou cancelado é histórico: nem observação muda", async () => {
    const admin = await ctxFor("ADMIN");
    const otherCase = await internalCase(`Caso financeiro 030 cancelado ${world.run}`);
    const { id } = await finance.createAgreement(admin, createAgreementSchema.parse({ idempotencyKey: key(), legalProcessId: await processForCase(otherCase) }));
    await finance.changeAgreementStatus(admin, { id, to: "CANCELLED" });
    const direct = await admin.db.from("financial_agreements").update({ notes: "x" }).eq("id", id);
    expect(direct.error?.message).toMatch(/histórico/);
  });
});

describe("lista e visão geral (leitura das telas)", () => {
  it("linha da lista traz caso, cliente e totais do ledger; visão geral agrega no servidor", async () => {
    const admin = await ctxFor("ADMIN");
    const page = await finance.listAgreementRows(admin, listAgreementRowsSchema.parse({ legalCaseId: caseId }));
    expect(page.items[0]).toMatchObject({ caseTitle: expect.stringContaining("Caso financeiro 030"), clientName: "Cliente Financeiro 030", status: "COMPLETED", inProcessTotals: true });
    expect(page.items[0].totals).toMatchObject({ contracted: 900, received: 900, outstanding: 0 });
    // Busca por cliente, filtrada no banco (064).
    const found = await finance.listAgreementRows(admin, listAgreementRowsSchema.parse({ legalCaseId: caseId, q: "Cliente Financeiro" }));
    expect(found.total).toBeGreaterThanOrEqual(1);
    const none = await finance.listAgreementRows(admin, listAgreementRowsSchema.parse({ legalCaseId: caseId, q: "ninguém com este nome" }));
    expect(none.total).toBe(0);
    const summary = await finance.getFinanceSummary(admin);
    expect(summary.monthly).toHaveLength(12);
    expect(summary.agreementsByStatus.COMPLETED).toBeGreaterThanOrEqual(1);
    expect(summary.totals.received).toBeGreaterThanOrEqual(900);
    // Totais da visão geral = totais por processo (a Home e o Financeiro leem a mesma conta, 064).
    const processTotals = await finance.getProcessFinanceTotals(admin);
    expect([summary.totals.received, summary.totals.outstanding, summary.totals.overdue]).toEqual([processTotals.receivedTotal, processTotals.openTotal, processTotals.overdueTotal]);
  });

  it("LAWYER, ASSISTANT e parceiros não leem a lista nem a visão geral", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN_A", "PARTNER_USER_A"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(finance.listAgreementRows(ctx, listAgreementRowsSchema.parse({})), "FORBIDDEN");
      await expectDomainError(finance.getFinanceSummary(ctx), "FORBIDDEN");
    }
  });
});
