import type { RequirementInternalDTO, RequirementPartnerDTO } from "./dto";
import type { RequirementStatus } from "./schemas";

/** Linha de `case_document_requirements` (colunas explícitas no repository). */
export interface RequirementRow {
  id: string;
  legal_case_id: string;
  requirement_label: string;
  category: string;
  required: boolean;
  status: RequirementStatus;
  satisfied_by_document_version_id: string | null;
  requested_at: string | null;
  satisfied_at: string | null;
  created_at: string;
  updated_at: string;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function internalRequirementFromRow(row: RequirementRow): RequirementInternalDTO {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    label: row.requirement_label,
    category: row.category,
    required: row.required,
    status: row.status,
    satisfiedByDocumentVersionId: opt(row.satisfied_by_document_version_id),
    requestedAt: opt(row.requested_at),
    satisfiedAt: opt(row.satisfied_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Parceiro: sem o id da versão que atende. */
export function partnerRequirementFromRow(row: RequirementRow): RequirementPartnerDTO {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    label: row.requirement_label,
    category: row.category,
    required: row.required,
    status: row.status,
    requestedAt: opt(row.requested_at),
    satisfiedAt: opt(row.satisfied_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Máquina de estados da pendência (aplicação; o banco garante que      */
/* RECEIVED/APPROVED têm versão e que a versão é do caso)               */
/* ------------------------------------------------------------------ */

export type RequirementTransition = "REQUEST" | "SATISFY" | "APPROVE" | "REJECT";

/** De quais estados cada transição parte. */
export const REQUIREMENT_TRANSITIONS: Record<RequirementTransition, { from: readonly RequirementStatus[]; to: RequirementStatus }> = {
  // Pedir (ou pedir de novo depois de rejeitar).
  REQUEST: { from: ["MISSING", "REJECTED"], to: "REQUESTED" },
  // Atender com uma versão (também troca a versão de uma pendência já recebida).
  SATISFY: { from: ["MISSING", "REQUESTED", "REJECTED", "RECEIVED"], to: "RECEIVED" },
  APPROVE: { from: ["RECEIVED"], to: "APPROVED" },
  REJECT: { from: ["RECEIVED"], to: "REJECTED" },
};

export function canTransition(from: RequirementStatus, transition: RequirementTransition): boolean {
  return REQUIREMENT_TRANSITIONS[transition].from.includes(from);
}
