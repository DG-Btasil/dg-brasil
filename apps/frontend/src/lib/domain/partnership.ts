/**
 * Regras financeiras da parceria (fonte única, pura).
 *
 * - A divisão do PartnerOffice é o padrão para NOVOS casos.
 * - Quando o caso passa a ter acordo, os percentuais são COPIADOS para o
 *   CasePartnershipAgreement (snapshot) e nunca recalculados.
 * - O que se divide são os honorários (receita do escritório), nunca o
 *   valor da causa.
 * - Estimativas são estimativas: a interface as rotula como tal.
 */
import type { CasePartnershipAgreement, ID, PartnerFinancialSummary, PartnerOffice, PartnershipAgreementView } from "@/types";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A divisão só é válida se cada parte estiver entre 0 e 100 e a soma for exatamente 100. */
export function isValidShare(partnerPercentage: number, ownerPercentage: number): boolean {
  const inRange = (v: number) => Number.isFinite(v) && v >= 0 && v <= 100;
  return inRange(partnerPercentage) && inRange(ownerPercentage) && round2(partnerPercentage + ownerPercentage) === 100;
}

export function shareOf(amount: number, percentage: number): number {
  return round2((amount * percentage) / 100);
}

/** Copia a divisão VIGENTE do parceiro para o acordo do caso (no ACEITE). */
export function snapshotAgreement(
  partner: Pick<PartnerOffice, "id" | "officeId" | "partnershipPercentage" | "ownerPercentage">,
  legalCaseId: ID,
  id: ID,
  at: string,
): CasePartnershipAgreement {
  return {
    id,
    officeId: partner.officeId,
    legalCaseId,
    partnerOfficeId: partner.id,
    partnerPercentage: partner.partnershipPercentage,
    ownerPercentage: partner.ownerPercentage,
    effectiveAt: at,
    payouts: [],
    createdAt: at,
    updatedAt: at,
  };
}

export function paidToPartner(agreement: CasePartnershipAgreement): number {
  return round2(agreement.payouts.reduce((sum, p) => sum + p.amount, 0));
}

/** Acordo com estimativas, realizados e saldo derivados. */
export function partnershipView(agreement: CasePartnershipAgreement): PartnershipAgreementView {
  const { revenueBase, realizedRevenue, partnerPercentage, ownerPercentage } = agreement;
  const paid = paidToPartner(agreement);
  const realizedPartner = realizedRevenue !== undefined ? shareOf(realizedRevenue, partnerPercentage) : undefined;
  const pending = realizedPartner !== undefined ? Math.max(0, round2(realizedPartner - paid)) : 0;
  const status =
    realizedPartner !== undefined
      ? pending > 0
        ? "TO_RECEIVE"
        : "SETTLED"
      : revenueBase !== undefined
        ? "ESTIMATED"
        : "AWAITING_ESTIMATE";
  return {
    ...agreement,
    status,
    estimatedPartnerAmount: revenueBase !== undefined ? shareOf(revenueBase, partnerPercentage) : undefined,
    estimatedOwnerAmount: revenueBase !== undefined ? shareOf(revenueBase, ownerPercentage) : undefined,
    realizedPartnerAmount: realizedPartner,
    realizedOwnerAmount: realizedRevenue !== undefined ? shareOf(realizedRevenue, ownerPercentage) : undefined,
    paidPartnerAmount: paid,
    // Neste protótipo, a parte da Bárbara é considerada recebida quando o honorário é realizado.
    paidOwnerAmount: realizedRevenue !== undefined ? shareOf(realizedRevenue, ownerPercentage) : undefined,
    pendingPartnerAmount: pending,
  };
}

export function summarizePartnerFinance(partnerOfficeId: ID, agreements: CasePartnershipAgreement[]): PartnerFinancialSummary {
  // Acordos encerrados (origem do caso alterada após o aceite) ficam só no histórico.
  const views = agreements.filter((a) => a.partnerOfficeId === partnerOfficeId && !a.cancelledAt).map(partnershipView);
  return {
    partnerOfficeId,
    accumulatedShare: round2(views.reduce((s, v) => s + (v.realizedPartnerAmount ?? 0), 0)),
    received: round2(views.reduce((s, v) => s + v.paidPartnerAmount, 0)),
    toReceive: round2(views.reduce((s, v) => s + v.pendingPartnerAmount, 0)),
    estimatedShare: round2(views.reduce((s, v) => s + (v.realizedPartnerAmount === undefined ? (v.estimatedPartnerAmount ?? 0) : 0), 0)),
    agreements: views.length,
  };
}
