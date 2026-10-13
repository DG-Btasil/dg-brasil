import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as finance from "@/server/domain/finance/service";
import {
  createAgreementSchema,
  createPaymentSchema,
  createTransferSchema,
  listAllocationsSchema,
  listPartnerAgreementSharesSchema,
  listPaymentsSchema,
  listTransfersSchema,
  registerAdjustmentSchema,
  registerReceiptSchema,
  registerReversalSchema,
} from "@/server/domain/finance/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Financeiro no Supabase DEV real: ledger append-only, divisão gerada pelo
 * banco a partir do snapshot, status derivado, repasses, e isolamento —
 * PARTNER_ADMIN só a própria parceria, PARTNER_USER/LAWYER/ASSISTANT nada.
 */

/** Chave de idempotência: o navegador gera uma por formulário. */
const key = () => randomUUID();

const GENERIC_FORBIDDEN = /^Você não tem permissão para esta operação\.$/;

const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Caso com origem no parceiro A, aceito pela equipe interna: o trigger do
 * banco cria o snapshot de parceria (50/50, padrão do cenário).
 */
async function acceptedPartnerCase(title = "Caso financeiro"): Promise<string> {
  const pa = await ctxFor("PARTNER_ADMIN_A");
  const { data, error } = await pa.db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Financeiro Integração" },
    p_case: { legal_area_id: world.bankingAreaId, title, origin_organization_id: world.partnerA },
  });
  expect(error).toBeNull();
  const caseId = (data as { legal_case_id: string }).legal_case_id;
  const lawyer = await ctxFor("LAWYER");
  const accepted = await lawyer.db.from("legal_cases").update({ status: "ACCEPTED", assigned_lawyer_id: world.users.LAWYER.id }).eq("id", caseId);
  expect(accepted.error).toBeNull();
  return caseId;
}

/** Acordo ATIVO + obrigação de `amount` no caso, criados pelo ADMIN pelos services. */
async function agreementWithPayment(caseId: string, amount: number, dueDate = isoDate(30)) {
  const admin = await ctxFor("ADMIN");
  const agreement = await finance.createAgreement(admin, createAgreementSchema.parse({ idempotencyKey: key(), legalCaseId: caseId, fixedFee: amount, activate: true }));
  const payment = await finance.createPayment(admin, createPaymentSchema.parse({ idempotencyKey: key(), agreementId: agreement.id, amount, dueDate, paymentType: "FIXED", description: "Parcela única" }));
  return { agreementId: agreement.id, paymentId: payment.id };
}

let caseA: string;

beforeAll(async () => {
  caseA = await acceptedPartnerCase("Caso financeiro principal");
});

describe("financeiro — ADMIN", () => {
  it("snapshot de parceria nasce no aceite com o percentual vigente do parceiro", async () => {
    const result = await finance.listCasePartnerships(await ctxFor("ADMIN"), caseA);
    expect(result.surface).toBe("INTERNAL");
    if (result.surface !== "INTERNAL") throw new Error("superfície");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ partnerOrganizationId: world.partnerA, partnerPercentage: 50, ownerPercentage: 50, status: "ACTIVE" });
  });

  it("recebimento gera divisão pelo banco; estorno inverte; ajuste exige justificativa; status é derivado", async () => {
    const admin = await ctxFor("ADMIN");
    const { paymentId } = await agreementWithPayment(caseA, 1000);

    const fresh = await finance.getPayment(admin, paymentId);
    expect(fresh).toMatchObject({ amount: 1000, receivedAmount: 0, balance: 1000, status: "PENDING", uiStatus: "PENDING" });
    expect(fresh).not.toHaveProperty("paidAmount");

    const first = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 400.01, method: "PIX" }));
    expect(first.deduplicated).toBe(false);
    expect(await finance.getPayment(admin, paymentId)).toMatchObject({ receivedAmount: 400.01, balance: 599.99, status: "PARTIAL", uiStatus: "PARTIALLY_PAID" });

    // Divisão: gerada pelo banco com o percentual congelado (ninguém digita).
    const alloc = await finance.listAllocations(admin, listAllocationsSchema.parse({ receiptId: first.receiptId }));
    expect(alloc.items).toHaveLength(1);
    const division = alloc.items[0];
    expect(division).toMatchObject({ baseAmount: 400.01, partnerPercentage: 50 });
    expect(Math.round((division.partnerAmount + division.ownerAmount) * 100)).toBe(40001);

    // Estorno integral: obrigação volta a PENDING e a divisão inversa aponta a original.
    const reversal = await finance.registerReversal(admin, registerReversalSchema.parse({ idempotencyKey: key(), originalReceiptId: first.receiptId, notes: "Devolvido pelo banco" }));
    expect(await finance.getPayment(admin, paymentId)).toMatchObject({ receivedAmount: 0, status: "PENDING" });
    const inverse = await finance.listAllocations(admin, listAllocationsSchema.parse({ receiptId: reversal.receiptId }));
    expect(inverse.items[0]).toMatchObject({ reversesAllocationId: division.id, partnerAmount: -division.partnerAmount, baseAmount: -400.01 });
    // Estornar de novo o que já foi estornado: recusado.
    await expectDomainError(finance.registerReversal(admin, registerReversalSchema.parse({ idempotencyKey: key(), originalReceiptId: first.receiptId, amount: 1 })), "INVALID_STATE");

    // Quitar o saldo (sem valor) e depois ajuste para menos, com justificativa.
    const settle = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId }));
    expect(await finance.getPayment(admin, paymentId)).toMatchObject({ receivedAmount: 1000, balance: 0, status: "PAID", uiStatus: "PAID" });
    const adjustment = await finance.registerAdjustment(
      admin,
      registerAdjustmentSchema.parse({ idempotencyKey: key(), paymentId, direction: "DECREASE", amount: 100, justification: "Tarifa bancária descontada", originalReceiptId: settle.receiptId }),
    );
    expect(await finance.getPayment(admin, paymentId)).toMatchObject({ receivedAmount: 900, status: "PARTIAL" });

    const ledger = await finance.listReceipts(admin, { paymentId, page: 1, pageSize: 50 });
    expect(ledger.items.map((r) => [r.kind, r.amount])).toEqual([
      ["RECEIPT", 400.01],
      ["REVERSAL", -400.01],
      ["RECEIPT", 1000],
      ["ADJUSTMENT", -100],
    ]);
    expect(ledger.items[3]).toMatchObject({ id: adjustment.receiptId, notes: "Tarifa bancária descontada", originalReceiptId: settle.receiptId });

    // Nada acima da obrigação.
    await expectDomainError(finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 100.01 })), "BUSINESS_RULE");
  });

  it("idempotência por chave: mesma chave → mesmo registro; chaves diferentes → registros diferentes, mesmo idênticos", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso idempotência");
    const { paymentId } = await agreementWithPayment(caseId, 500);

    // Mesma chave, inclusive em envios simultâneos (corrida cai no índice único).
    const input = registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 120 });
    const a = await finance.registerReceipt(admin, input);
    const b = await finance.registerReceipt(admin, input);
    expect(b).toEqual({ receiptId: a.receiptId, deduplicated: true });
    const race = registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 10 });
    const [r1, r2] = await Promise.all([finance.registerReceipt(admin, race), finance.registerReceipt(admin, race)]);
    expect(r1.receiptId).toBe(r2.receiptId);
    expect([r1.deduplicated, r2.deduplicated].sort()).toEqual([false, true]);

    // Chaves diferentes com dados idênticos: dois lançamentos legítimos.
    const c = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 120 }));
    expect(c.deduplicated).toBe(false);
    expect(c.receiptId).not.toBe(a.receiptId);

    // "Quitar saldo" reenviado com a mesma chave: devolve o primeiro, não erra por saldo zero.
    const settleInput = registerReceiptSchema.parse({ idempotencyKey: key(), paymentId });
    const settle = await finance.registerReceipt(admin, settleInput);
    expect(await finance.registerReceipt(admin, settleInput)).toEqual({ receiptId: settle.receiptId, deduplicated: true });
    // Com chave nova, a obrigação já está quitada.
    await expectDomainError(finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId })), "INVALID_STATE");

    const { count } = await serviceDb().from("payment_receipts").select("id", { count: "exact", head: true }).eq("payment_id", paymentId);
    expect(count).toBe(4);

    // Obrigação: mesma chave → mesma; chave nova com dados idênticos → outra.
    const { data: payRow } = await serviceDb().from("payments").select("financial_agreement_id").eq("id", paymentId).single();
    const agreementId = (payRow as { financial_agreement_id: string }).financial_agreement_id;
    const payInput = createPaymentSchema.parse({ idempotencyKey: key(), agreementId, amount: 75, paymentType: "OTHER" });
    const p1 = await finance.createPayment(admin, payInput);
    expect(await finance.createPayment(admin, payInput)).toEqual({ id: p1.id, deduplicated: true });
    const p2 = await finance.createPayment(admin, { ...payInput, idempotencyKey: key() });
    expect(p2.id).not.toBe(p1.id);

    // Estorno com a mesma chave: um só.
    const revInput = registerReversalSchema.parse({ idempotencyKey: key(), originalReceiptId: c.receiptId });
    const rev = await finance.registerReversal(admin, revInput);
    expect(await finance.registerReversal(admin, revInput)).toEqual({ receiptId: rev.receiptId, deduplicated: true });
  });

  it("obrigação vencida com saldo é OVERDUE (fuso de São Paulo, derivado pela view)", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso vencido");
    const { agreementId, paymentId } = await agreementWithPayment(caseId, 300, isoDate(-3));
    expect(await finance.getPayment(admin, paymentId)).toMatchObject({ status: "OVERDUE", uiStatus: "OVERDUE" });
    const page = await finance.listPayments(admin, listPaymentsSchema.parse({ agreementId, status: "OVERDUE" }));
    expect(page.items.map((p) => p.id)).toEqual([paymentId]);
  });

  it("lançamento existente não muda nem é apagado — nem pelo ADMIN, nem pela service role", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso append-only");
    const { paymentId } = await agreementWithPayment(caseId, 200);
    const { receiptId } = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 50, notes: "original" }));

    const update = await admin.db.from("payment_receipts").update({ amount: 200, notes: "alterado" }).eq("id", receiptId);
    expect(update.error).not.toBeNull();
    const remove = await admin.db.from("payment_receipts").delete().eq("id", receiptId);
    expect(remove.error).not.toBeNull();
    const asService = await serviceDb().from("payment_receipts").update({ notes: "alterado" }).eq("id", receiptId);
    expect(asService.error).not.toBeNull();

    const { data } = await serviceDb().from("payment_receipts").select("amount, notes").eq("id", receiptId).single();
    expect(data).toMatchObject({ amount: 50, notes: "original" });
    // A divisão também não se digita nem se altera.
    const allocInsert = await admin.db.from("partner_revenue_allocations").insert({ receipt_id: receiptId, case_partnership_agreement_id: receiptId, base_amount: 1, partner_percentage: 100, partner_amount: 1, owner_amount: 0 });
    expect(allocInsert.error).not.toBeNull();
  });

  it("regras do acordo e da obrigação", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso regras do acordo");
    // Primeiro acordo ATIVO gravado direto no banco (como ADMIN).
    const direct = await admin.db.from("financial_agreements").insert({ legal_case_id: caseId, status: "ACTIVE", fixed_fee: 100 }).select("id").single();
    expect(direct.error).toBeNull();
    const agreementId = (direct.data as { id: string }).id;
    await expectDomainError(finance.createAgreement(admin, createAgreementSchema.parse({ idempotencyKey: key(), legalCaseId: caseId, activate: true })), "CONFLICT", /acordo financeiro ativo/);

    // Reenvio do mesmo formulário (mesma chave) devolve o mesmo rascunho; chave nova cria outro.
    const draftInput = createAgreementSchema.parse({ idempotencyKey: key(), legalCaseId: caseId, fixedFee: 10 });
    const draftA = await finance.createAgreement(admin, draftInput);
    expect(await finance.createAgreement(admin, draftInput)).toEqual({ id: draftA.id, deduplicated: true });
    const draftC = await finance.createAgreement(admin, { ...draftInput, idempotencyKey: key() });
    expect(draftC).toMatchObject({ deduplicated: false });
    expect(draftC.id).not.toBe(draftA.id);

    // Termos de acordo ativo não mudam; rascunho muda.
    await expectDomainError(finance.updateAgreement(admin, { id: agreementId, patch: { fixedFee: 1 } }), "INVALID_STATE");
    await finance.updateAgreement(admin, { id: draftA.id, patch: { fixedFee: 20, notes: "ajustado" } });
    expect(await finance.getAgreement(admin, draftA.id)).toMatchObject({ status: "DRAFT", fixedFee: 20, notes: "ajustado" });

    // Obrigação com recebimento não cancela; acordo com obrigação em aberto não conclui nem cancela.
    const payment = await finance.createPayment(admin, createPaymentSchema.parse({ idempotencyKey: key(), agreementId, amount: 100, paymentType: "FIXED", dueDate: isoDate(10) }));
    const receipt = await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId: payment.id, amount: 30 }));
    await expectDomainError(finance.cancelPayment(admin, { id: payment.id, reason: "Lançada por engano" }), "BUSINESS_RULE");
    await expectDomainError(finance.changeAgreementStatus(admin, { id: agreementId, to: "COMPLETED" }), "BUSINESS_RULE");
    await finance.registerReversal(admin, registerReversalSchema.parse({ idempotencyKey: key(), originalReceiptId: receipt.receiptId }));
    await finance.cancelPayment(admin, { id: payment.id, reason: "Lançada por engano" });
    const cancelled = await finance.getPayment(admin, payment.id);
    expect(cancelled).toMatchObject({ status: "CANCELLED", uiStatus: null, cancellationReason: "Lançada por engano" });
    await expectDomainError(finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId: payment.id, amount: 10 })), "INVALID_STATE");
    await finance.changeAgreementStatus(admin, { id: agreementId, to: "CANCELLED" });
    expect((await finance.getAgreement(admin, agreementId)).status).toBe("CANCELLED");
    await expectDomainError(finance.changeAgreementStatus(admin, { id: agreementId, to: "ACTIVE" }), "INVALID_STATE");
  });

  it("repasse: pendente consome saldo, pago conta como repassado, cancelado devolve o saldo", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso repasse");
    const { paymentId } = await agreementWithPayment(caseId, 1000);
    await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 1000 }));

    const before = (await finance.getPartnerFinance(admin, { partnerOrganizationId: world.partnerA })).totals;
    const transferInput = createTransferSchema.parse({ idempotencyKey: key(), partnerOrganizationId: world.partnerA, amount: 300, legalCaseId: caseId, reference: "PIX integração" });
    const transfer = await finance.createTransfer(admin, transferInput);
    expect(transfer.deduplicated).toBe(false);
    // Mesma chave (reenvio): o mesmo repasse, sem consumir saldo de novo (RPC atômica da 026).
    expect(await finance.createTransfer(admin, transferInput)).toEqual({ id: transfer.id, deduplicated: true });
    const detail = await finance.getTransfer(admin, transfer.id);
    expect(detail).toMatchObject({ status: "PENDING", amount: 300 });
    expect(detail.items?.reduce((s, i) => s + i.amount, 0)).toBe(300);

    const pending = (await finance.getPartnerFinance(admin, { partnerOrganizationId: world.partnerA })).totals;
    expect(Math.round((before.availableAmount - pending.availableAmount) * 100)).toBe(30000);
    expect(Math.round((pending.pendingTransferAmount - before.pendingTransferAmount) * 100)).toBe(30000);

    await finance.markTransferPaid(admin, { id: transfer.id });
    const paid = (await finance.getPartnerFinance(admin, { partnerOrganizationId: world.partnerA })).totals;
    expect(Math.round((paid.paidOutAmount - before.paidOutAmount) * 100)).toBe(30000);
    expect(paid.availableAmount).toBe(pending.availableAmount);

    await finance.cancelTransfer(admin, { id: transfer.id, reason: "Pago em duplicidade" });
    const after = (await finance.getPartnerFinance(admin, { partnerOrganizationId: world.partnerA })).totals;
    expect(after).toEqual(before);
    expect((await finance.getTransfer(admin, transfer.id)).status).toBe("CANCELLED");
    await expectDomainError(finance.cancelTransfer(admin, { id: transfer.id, reason: "de novo" }), "INVALID_STATE");

    // Mais que o disponível: recusado antes de gravar qualquer coisa.
    await expectDomainError(
      finance.createTransfer(admin, createTransferSchema.parse({ idempotencyKey: key(), partnerOrganizationId: world.partnerA, amount: after.availableAmount + 1000, legalCaseId: caseId })),
      "BUSINESS_RULE",
    );
  });
});

describe("financeiro — Portal do Parceiro e isolamento", () => {
  it("PARTNER_ADMIN_A vê só o resumo da própria parceria, sem total do escritório", async () => {
    const admin = await ctxFor("ADMIN");
    const caseId = await acceptedPartnerCase("Caso visão do parceiro");
    const { paymentId } = await agreementWithPayment(caseId, 800);
    await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 800, notes: "nota interna do financeiro" }));

    const pa = await ctxFor("PARTNER_ADMIN_A");
    const summary = await finance.getPartnerFinance(pa, {});
    expect(summary.partnerOrganizationId).toBe(world.partnerA);
    expect(Object.keys(summary.totals).sort()).toEqual(["accruedAmount", "availableAmount", "paidOutAmount", "pendingTransferAmount"]);
    expect(summary.totals.accruedAmount).toBeGreaterThanOrEqual(400);
    expect(summary.activeAgreementCount).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(summary);
    for (const leak of ["owner", "base", "receipt", "nota interna"]) expect(json.toLowerCase()).not.toContain(leak);

    const shares = await finance.listPartnerAgreementShares(pa, listPartnerAgreementSharesSchema.parse({ pageSize: 50 }));
    const share = shares.items.find((s) => s.legalCaseId === caseId);
    expect(share).toMatchObject({ partnerPercentage: 50, accruedAmount: 400, availableAmount: 400, status: "ACTIVE" });
    expect(JSON.stringify(shares)).not.toMatch(/owner|baseAmount|receiptId/i);

    const snap = await finance.listCasePartnerships(pa, caseId);
    expect(snap.surface).toBe("PARTNER");
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).not.toHaveProperty("ownerPercentage");
    expect(snap.items[0]).not.toHaveProperty("cancellationReason");

    const transfers = await finance.listTransfers(pa, listTransfersSchema.parse({ pageSize: 50 }));
    for (const t of transfers.items) {
      expect(t).not.toHaveProperty("registeredBy");
      expect(t).not.toHaveProperty("cancellationReason");
    }
    if (transfers.items.length) {
      const { data } = await serviceDb().from("partner_transfers").select("partner_organization_id").in("id", transfers.items.map((t) => t.id));
      expect(new Set((data ?? []).map((r) => r.partner_organization_id))).toEqual(new Set([world.partnerA]));
    }

    // Financeiro geral: nunca. Nem pelo service, nem direto no banco (RLS).
    await expectDomainError(finance.listPayments(pa, listPaymentsSchema.parse({ legalCaseId: caseId })), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.registerReceipt(pa, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId, amount: 1 })), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.listAllocations(pa, listAllocationsSchema.parse({ legalCaseId: caseId })), "FORBIDDEN", GENERIC_FORBIDDEN);
    for (const table of ["payments", "payment_receipts", "financial_agreements", "fee_models"]) {
      const { data } = await pa.db.from(table).select("id").limit(5);
      expect(data ?? [], table).toEqual([]);
    }
    const insert = await pa.db.from("payment_receipts").insert({ payment_id: paymentId, kind: "RECEIPT", amount: 1 });
    expect(insert.error).not.toBeNull();
    expect(insert.error?.message ?? "").not.toMatch(/\d{2,}/);
  });

  it("PARTNER_USER_A não tem financeiro (FORBIDDEN genérico)", async () => {
    const pu = await ctxFor("PARTNER_USER_A");
    await expectDomainError(finance.getPartnerFinance(pu, {}), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.listPartnerAgreementShares(pu, listPartnerAgreementSharesSchema.parse({})), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.listCasePartnerships(pu, caseA), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.listTransfers(pu, listTransfersSchema.parse({})), "FORBIDDEN", GENERIC_FORBIDDEN);
    const { data } = await pu.db.from("partner_allocation_balances").select("allocation_id").limit(5);
    expect(data ?? []).toEqual([]);
  });

  it("PARTNER_ADMIN_B não vê a parceria de A (IDOR)", async () => {
    const pb = await ctxFor("PARTNER_ADMIN_B");
    await expectDomainError(finance.getPartnerFinance(pb, { partnerOrganizationId: world.partnerA }), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(finance.listTransfers(pb, listTransfersSchema.parse({ partnerOrganizationId: world.partnerA })), "FORBIDDEN", GENERIC_FORBIDDEN);
    await expectDomainError(
      finance.listPartnerAgreementShares(pb, listPartnerAgreementSharesSchema.parse({ partnerOrganizationId: world.partnerA })),
      "FORBIDDEN",
      GENERIC_FORBIDDEN,
    );
    expect((await finance.listCasePartnerships(pb, caseA)).items).toEqual([]);

    const own = await finance.getPartnerFinance(pb, {});
    expect(own.partnerOrganizationId).toBe(world.partnerB);
    expect(own.totals.accruedAmount).toBe(0);

    for (const table of ["case_partnership_agreements", "partner_revenue_allocations", "partner_allocation_balances", "partner_transfers"]) {
      const column = table === "partner_allocation_balances" ? "allocation_id" : "id";
      const { data } = await pb.db.from(table).select(column).limit(5);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("LAWYER e ASSISTANT não têm acesso ao financeiro", async () => {
    const { data: anyPayment } = await serviceDb().from("payments").select("id").limit(1).single();
    for (const role of ["LAWYER", "ASSISTANT"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(finance.listAgreements(ctx, { page: 1, pageSize: 5, column: "created_at", ascending: false }), "FORBIDDEN");
      await expectDomainError(finance.listPayments(ctx, listPaymentsSchema.parse({ legalCaseId: caseA })), "FORBIDDEN");
      await expectDomainError(finance.createAgreement(ctx, createAgreementSchema.parse({ idempotencyKey: key(), legalCaseId: caseA })), "FORBIDDEN");
      await expectDomainError(finance.listCasePartnerships(ctx, caseA), "FORBIDDEN");
      await expectDomainError(finance.getPartnerFinance(ctx, { partnerOrganizationId: world.partnerA }), "FORBIDDEN");
      await expectDomainError(finance.listTransfers(ctx, listTransfersSchema.parse({})), "FORBIDDEN");
      // Direto no banco: a RLS esconde e o trigger recusa (ADMIN antes de qualquer regra).
      const { data } = await ctx.db.from("payment_balances").select("payment_id").limit(5);
      expect(data ?? [], role).toEqual([]);
      const insert = await ctx.db.from("payment_receipts").insert({ payment_id: (anyPayment as { id: string }).id, kind: "RECEIPT", amount: 1 });
      expect(insert.error, role).not.toBeNull();
    }
  });
});
