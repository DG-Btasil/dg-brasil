/**
 * Regras do Caso Jurídico (fonte única, pura).
 *
 *   Client → LegalCase → LegalProcess
 *
 * - A origem do CASO decide a parceria (nunca a origem histórica do cliente).
 * - Antes da decisão, o status do caso acompanha a análise jurídica dele.
 * - Aceitar exige advogado responsável; o acordo de parceria nasce no aceite.
 */
import {
  ACCEPTED_CASE_STATUSES,
  DECIDABLE_CASE_STATUSES,
  PRE_DECISION_CASE_STATUSES,
  type AnalysisStatus,
  type LegalCaseStatus,
} from "@/lib/constants/status";
import type { ID, LegalAnalysis, LegalCase, User } from "@/types";

/**
 * Parceiro de ORIGEM do caso (atribuição comercial → parceria/divisão).
 * Não decide visibilidade: o acesso do parceiro é `partnerOrganizationId`.
 */
export function casePartnerId(legalCase: Pick<LegalCase, "originOrganizationId">, ownerOfficeId: ID): ID | undefined {
  return legalCase.originOrganizationId !== ownerOfficeId ? legalCase.originOrganizationId : undefined;
}

/**
 * Parceiro a vincular OPERACIONALMENTE quando a equipe interna marca, de forma
 * explícita, "também vincular este escritório parceiro ao caso". A origem, por
 * si só, nunca concede acesso: sem o opt-in (ou com origem própria), null.
 */
export function explicitPartnerLink(originOrganizationId: ID, ownerOfficeId: ID, linkPartner: boolean | undefined): ID | null {
  return linkPartner && originOrganizationId !== ownerOfficeId ? originOrganizationId : null;
}

export const isPreDecision = (status: LegalCaseStatus) => PRE_DECISION_CASE_STATUSES.includes(status);
export const isDecidable = (status: LegalCaseStatus) => DECIDABLE_CASE_STATUSES.includes(status);
export const isAccepted = (status: LegalCaseStatus) => ACCEPTED_CASE_STATUSES.includes(status);

/** Status do caso correspondente à análise (somente enquanto o caso não foi decidido). */
const ANALYSIS_TO_CASE: Partial<Record<AnalysisStatus, LegalCaseStatus>> = {
  WAITING_DOCUMENTS: "WAITING_DOCUMENTS",
  READY: "READY_FOR_ANALYSIS",
  ANALYZING: "ANALYZING",
  WAITING_REVIEW: "WAITING_REVIEW",
  // Análise aprovada: o caso aguarda a decisão humana (aceitar ou rejeitar).
  COMPLETED: "WAITING_REVIEW",
  // Interrompida por divergência/documentação: volta a depender de documentos.
  INTERRUPTED: "WAITING_DOCUMENTS",
};

/**
 * Sincroniza o status dos casos ainda não decididos com suas análises.
 * Devolve o mesmo array quando nada muda (referência estável).
 */
export function syncCaseStatuses(cases: LegalCase[], analyses: LegalAnalysis[], at: string): LegalCase[] {
  const byId = new Map(analyses.map((a) => [a.id, a]));
  let changed = false;
  const next = cases.map((c) => {
    if (!c.analysisId || !isDecidable(c.status)) return c;
    const analysis = byId.get(c.analysisId);
    const target = analysis ? ANALYSIS_TO_CASE[analysis.status] : undefined;
    if (!target || target === c.status) return c;
    changed = true;
    return { ...c, status: target, updatedAt: at };
  });
  return changed ? next : cases;
}

/**
 * Advogados que podem ser responsáveis por um caso: usuários internos ativos
 * com papel Advogado, ou Administrador inscrito na OAB.
 */
export function isEligibleLawyer(user: Pick<User, "role" | "status" | "oab" | "partnerOfficeId">): boolean {
  if (user.partnerOfficeId || user.status !== "ACTIVE") return false;
  return user.role === "LAWYER" || (user.role === "ADMIN" && !!user.oab);
}
