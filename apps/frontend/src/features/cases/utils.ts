import { daysSince } from "@/lib/clock";
import type { LegalArea } from "@/lib/constants/legal";
import type { LegalCaseStatus } from "@/lib/constants/status";
import type { LegalCaseRow } from "@/types";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export interface CaseFilters {
  q: string;
  status: LegalCaseStatus | "";
  area: LegalArea | "";
  /** "INTERNAL" = Bárbara Cardoso Advocacia; "PARTNER" = qualquer parceiro. */
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
    if (f.partnerOfficeId && c.originOfficeId !== f.partnerOfficeId) return false;
    if (f.lawyerId && c.assignedLawyerId !== f.lawyerId) return false;
    if (f.clientId && c.clientId !== f.clientId) return false;
    if (f.period && daysSince(c.createdAt) > Number(f.period)) return false;
    return true;
  });
}
