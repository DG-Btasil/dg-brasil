import { daysSince } from "@/lib/clock";
import type { LegalArea } from "@/lib/constants/legal";
import type { LegalCaseStatus } from "@/lib/constants/status";
import type { LegalCaseRow } from "@/types";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Exceções de situação que o sistema aceita (private.case_status_override_allowed,
 * migration 006): só Administrador, com motivo, registradas na auditoria.
 */
export const CASE_STATUS_OVERRIDES = {
  reopen: { from: "CLOSED", to: "IN_PROGRESS" },
  reconsider: { from: "REJECTED", to: "SUBMITTED" },
} as const satisfies Record<string, { from: LegalCaseStatus; to: LegalCaseStatus }>;
export type CaseStatusOverride = keyof typeof CASE_STATUS_OVERRIDES;

/** Exceção disponível para a situação atual do caso (reabrir encerrado, reconsiderar rejeição). */
export function caseStatusOverrideFor(status: LegalCaseStatus): CaseStatusOverride | undefined {
  return (Object.keys(CASE_STATUS_OVERRIDES) as CaseStatusOverride[]).find((k) => CASE_STATUS_OVERRIDES[k].from === status);
}

/**
 * Situações em que a equipe marca "Aguardando documentos" pela tela. O sistema
 * aceita outras origens (rascunho, análise em curso), que seguem o fluxo próprio.
 */
const WAIT_DOCUMENTS_FROM: readonly LegalCaseStatus[] = ["SUBMITTED", "READY_FOR_ANALYSIS", "WAITING_REVIEW"];
export const canMarkWaitingDocuments = (status: LegalCaseStatus) => WAIT_DOCUMENTS_FROM.includes(status);

export interface CaseFilters {
  q: string;
  status: LegalCaseStatus | "";
  area: LegalArea | "";
  /** "INTERNAL" = Barbara Cardoso Advocacia; "PARTNER" = qualquer parceiro. */
  origin: "" | "INTERNAL" | "PARTNER";
  partnerOfficeId: string;
  lawyerId: string;
  clientId: string;
  /** Criados nos últimos N dias. */
  period: "" | "7" | "30" | "90";
}

export const EMPTY_CASE_FILTERS: CaseFilters = { q: "", status: "", area: "", origin: "", partnerOfficeId: "", lawyerId: "", clientId: "", period: "" };

export const CASE_PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
] as const;

export function countCaseFilters(f: CaseFilters): number {
  return (Object.keys(f) as (keyof CaseFilters)[]).filter((k) => f[k] !== "").length;
}

export function filterCaseRows(rows: LegalCaseRow[], f: CaseFilters): LegalCaseRow[] {
  const q = normalize(f.q.trim());
  return rows.filter((r) => {
    const c = r.legalCase;
    if (q && !normalize([c.title, r.clientName, c.caseType, c.opposingParty ?? "", r.originName].join(" ")).includes(q)) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.area && c.area !== f.area) return false;
    if (f.origin === "INTERNAL" && r.partnerName) return false;
    if (f.origin === "PARTNER" && !r.partnerName) return false;
    if (f.partnerOfficeId && c.originOrganizationId !== f.partnerOfficeId) return false;
    if (f.lawyerId && c.assignedLawyerId !== f.lawyerId) return false;
    if (f.clientId && c.clientId !== f.clientId) return false;
    if (f.period && daysSince(c.createdAt) > Number(f.period)) return false;
    return true;
  });
}

/**
 * Opt-in explícito (equipe interna) ao escolher uma origem parceira: a origem
 * comercial nunca concede acesso; vincular o parceiro ao caso é ação separada.
 */
export const LINK_PARTNER_LABEL = "Também vincular este escritório parceiro ao caso (acesso operacional do parceiro)";
