import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as finance from "@/server/domain/finance/service";
import {
  createAgreementSchema,
  createPaymentScheduleSchema,
  createTransferSchema,
  listPartnerAgreementSharesSchema,
  listPaymentsSchema,
  registerReceiptSchema,
} from "@/server/domain/finance/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3.1 — financeiro (migration 035) no Supabase DEV real: cronograma
 * de parcelas atômico e idempotente (só obrigações), valores da parceria só
 * leitura e derivados, e "contratado por modelo" somado no banco.
 */

const key = () => randomUUID();
const svc = serviceDb();

async function acceptedPartnerCase(title: string): Promise<string> {
  const pa = await ctxFor("PARTNER_ADMIN_A");
  const { data, error } = await pa.db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Financeiro 4.3.1" },
    p_case: { legal_area_id: world.bankingAreaId, title, origin_organization_id: world.partnerA },
  });
  expect(error).toBeNull();
  const caseId = (data as { legal_case_id: string }).legal_case_id;
  const accepted = await (await ctxFor("LAWYER")).db.from("legal_cases").update({ status: "ACCEPTED", assigned_lawyer_id: world.users.LAWYER.id }).eq("id", caseId);
  expect(accepted.error).toBeNull();
  return caseId;
}

const newAgreement = async (caseId: string, activate = false, feeModelId?: string) =>
  (await finance.createAgreement(await ctxFor("ADMIN"), createAgreementSchema.parse({ idempotencyKey: key(), legalCaseId: caseId, fixedFee: 1000, activate, feeModelId }))).id;

const schedule = (agreementId: string, over: Record<string, unknown> = {}) =>
  createPaymentScheduleSchema.parse({ idempotencyKey: key(), agreementId, total: 100, installments: 3, firstDueDate: "2027-01-31", frequency: "MONTHLY", ...over });

let caseId = "";

beforeAll(async () => {
  caseId = await acceptedPartnerCase(`Caso financeiro 4.3.1 ${world.run}`);
});

describe("cronograma de parcelas (035)", () => {
  it("R$ 100,00 em 3: centavos exatos, vencimentos mensais; mesma chave não duplica; nenhum recebimento criado", async () => {
    const admin = await ctxFor("ADMIN");
    const agreementId = await newAgreement(caseId);
    const input = schedule(agreementId);
    const first = await finance.createPaymentSchedule(admin, input);
    const [again, concurrent] = await Promise.all([finance.createPaymentSchedule(admin, input), finance.createPaymentSchedule(admin, input)]);
    expect(first).toMatchObject({ count: 3, deduplicated: false });
    for (const r of [again, concurrent]) expect(r).toMatchObject({ paymentIds: first.paymentIds });
    const payments = await finance.listPayments(admin, listPaymentsSchema.parse({ agreementId, pageSize: 50, sortBy: "dueDate", sortDirection: "asc" }));
    expect(payments.items.map((p) => [p.amount, p.dueDate, p.description])).toEqual([
      [33.34, "2027-01-31", "Parcela 1/3"],
      [33.33, "2027-02-28", "Parcela 2/3"],
      [33.33, "2027-03-31", "Parcela 3/3"],
    ]);
    expect(payments.items.every((p) => p.receivedAmount === 0)).toBe(true);
    const { count } = await svc.from("payment_receipts").select("id", { count: "exact", head: true }).in("payment_id", first.paymentIds);
    expect(count).toBe(0);
  });

  it("acordo encerrado: recusado e nada gravado; LAWYER e parceiro: recusados", async () => {
    const admin = await ctxFor("ADMIN");
    const agreementId = await newAgreement(await acceptedPartnerCase(`Caso cancelado 4.3.1 ${world.run}`));
    await finance.changeAgreementStatus(admin, { id: agreementId, to: "CANCELLED" });
    await expectDomainError(finance.createPaymentSchedule(admin, schedule(agreementId)), "INVALID_STATE");
    const { count } = await svc.from("payments").select("id", { count: "exact", head: true }).eq("financial_agreement_id", agreementId);
    expect(count).toBe(0);
    const open = await newAgreement(await acceptedPartnerCase(`Caso aberto 4.3.1 ${world.run}`));
    await expectDomainError(finance.createPaymentSchedule(await ctxFor("LAWYER"), schedule(open)), "FORBIDDEN");
    await expectDomainError(finance.createPaymentSchedule(await ctxFor("PARTNER_ADMIN_A"), schedule(open)), "FORBIDDEN");
  });
});

describe("valores da parceria — só leitura (035)", () => {
  it("receita elegível e participação derivadas dos recebimentos; histórico de repasses do caso; parceiro A só os dele", async () => {
    const admin = await ctxFor("ADMIN");
    const agreementId = await newAgreement(caseId, true);
    const sched = await finance.createPaymentSchedule(admin, schedule(agreementId, { total: 600, installments: 2 }));
    await finance.registerReceipt(admin, registerReceiptSchema.parse({ idempotencyKey: key(), paymentId: sched.paymentIds[0] }));
    await finance.createTransfer(admin, createTransferSchema.parse({ idempotencyKey: key(), partnerOrganizationId: world.partnerA, amount: 50, legalCaseId: caseId }));

    const shares = await finance.listPartnerAgreementShares(admin, listPartnerAgreementSharesSchema.parse({ partnerOrganizationId: world.partnerA, pageSize: 50 }));
    const share = shares.items.find((s) => s.legalCaseId === caseId);
    expect(share).toMatchObject({ eligibleRevenue: 300, accruedAmount: 150, partnerPercentage: 50 });

    const detail = await finance.getPartnerShareDetail(admin, { agreementId: share!.agreementId });
    expect(detail).toMatchObject({ ownerPercentage: 50, ownerShare: 150, caseReceived: 300 });
    // Repasse direcionado a este caso: aparece no histórico do caso, com o valor deste caso.
    expect(detail.transfers.some((t) => t.amount === 50 && t.status === "PENDING")).toBe(true);
    // Coerência: itens não cancelados deste caso = repassado + em repasse.
    const live = detail.transfers.filter((t) => t.status !== "CANCELLED").reduce((a, t) => a + Math.round(t.amount * 100), 0);
    expect(live).toBe(Math.round((detail.share.paidOutAmount + detail.share.pendingTransferAmount) * 100));

    const asPartner = await finance.getPartnerShareDetail(await ctxFor("PARTNER_ADMIN_A"), { agreementId: share!.agreementId });
    expect(asPartner.share.eligibleRevenue).toBe(300);
    expect(asPartner.ownerShare).toBeUndefined();
    expect(asPartner.caseReceived).toBeUndefined();

    await expectDomainError(finance.getPartnerShareDetail(await ctxFor("PARTNER_ADMIN_B"), { agreementId: share!.agreementId }), "FORBIDDEN");
    await expectDomainError(finance.getPartnerShareDetail(await ctxFor("PARTNER_USER_A"), { agreementId: share!.agreementId }), "FORBIDDEN");
    await expectDomainError(finance.getPartnerShareDetail(await ctxFor("LAWYER"), { agreementId: share!.agreementId }), "FORBIDDEN");
  });

  it("nada se digita: a view não aceita escrita nem do ADMIN", async () => {
    const { error } = await (await ctxFor("ADMIN")).db.from("partner_agreement_share_totals").update({ partner_share: 1 }).eq("partner_organization_id", world.partnerA);
    expect(error).not.toBeNull();
  });
});

describe("contratado por modelo (035)", () => {
  it("somado no banco: obrigações não canceladas de acordos não cancelados, por modelo", async () => {
    const admin = await ctxFor("ADMIN");
    const model = await svc.from("fee_models").insert({ name: `Modelo 4.3.1 ${world.run}` }).select("id").single();
    if (model.error) throw new Error(model.error.message);
    const a1 = await newAgreement(await acceptedPartnerCase(`Caso modelo 1 ${world.run}`), false, model.data.id);
    const a2 = await newAgreement(await acceptedPartnerCase(`Caso modelo 2 ${world.run}`), false, model.data.id);
    await finance.createPaymentSchedule(admin, schedule(a1, { total: 1000, installments: 4 }));
    await finance.createPaymentSchedule(admin, schedule(a2, { total: 250.5, installments: 1 }));
    const summary = await finance.getFinanceSummary(admin);
    const point = summary.byFeeModel.find((p) => p.feeModelId === model.data.id) ?? summary.byFeeModel.find((p) => p.name === "Outros");
    expect(point).toBeDefined();
    if (point?.feeModelId === model.data.id) expect(point).toMatchObject({ total: 1250.5, count: 2 });
    await expectDomainError(finance.getFinanceSummary(await ctxFor("LAWYER")), "FORBIDDEN");
    await svc.from("fee_models").update({ active: false }).eq("id", model.data.id);
  });
});
