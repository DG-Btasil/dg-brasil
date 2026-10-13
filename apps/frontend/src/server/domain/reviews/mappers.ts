import {
  REVIEW_DECISION_TO_DB,
  reviewDecisionFromDb,
  reviewStatusFromDb,
  type DbAnalysisStatus,
  type DbReviewDecision,
  type DbReviewPriority,
  type DbReviewStatus,
} from "@/repositories/api/db-mappings";
import type { DocumentCategory, ReviewDecisionKind } from "@/lib/constants/status";
import { resultFromRow } from "../analyses/mappers";
import type { ReviewDecisionDTO, ReviewListItem, ReviewTargetDTO, ReviewTargetKind } from "./dto";
import type { AssignReviewInput } from "./schemas";

/**
 * Banco ↔ domínio da revisão humana. Funções puras, testadas em
 * reviews.test.ts (inclusive o mapeamento de decisão e status).
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface ReviewRow {
  id: string;
  legal_case_id: string | null;
  legal_process_id: string | null;
  document_version_id: string | null;
  legal_analysis_id: string | null;
  agent_proposal_id: string | null;
  status: DbReviewStatus;
  priority: DbReviewPriority;
  assigned_reviewer_id: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
  agent_proposals?: { proposal_type: string } | { proposal_type: string }[] | null;
}

export interface ReviewDecisionRow {
  id: string;
  decision: DbReviewDecision;
  notes: string | null;
  decided_by: string;
  created_at: string;
}

export interface AnalysisTargetRow {
  id: string;
  status: DbAnalysisStatus;
  analysis_template_id: string;
  agent_run_id: string | null;
  summary: string | null;
  result_data: unknown;
}

export interface DocumentVersionTargetRow {
  id: string;
  document_id: string;
  version_number: number;
  original_filename: string | null;
  mime_type: string | null;
  source: string;
  created_at: string;
  documents: { title: string; category: DocumentCategory; visibility: "INTERNAL" | "PARTNER_VISIBLE" } | { title: string; category: DocumentCategory; visibility: "INTERNAL" | "PARTNER_VISIBLE" }[] | null;
}

export interface ProposalTargetRow {
  id: string;
  agent_run_id: string;
  proposal_type: string;
  status: string;
  payload: unknown;
  requires_human_review: boolean;
  created_at: string;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/* ------------------------------------------------------------------ */
/* Regras de leitura                                                   */
/* ------------------------------------------------------------------ */

/**
 * Espelho de private.proposal_requires_admin (banco é a autoridade; aqui só
 * para mensagem amigável e para a interface esconder o botão do LAWYER).
 */
export function requiresAdminDecision(proposalType: string | undefined | null): boolean {
  if (!proposalType) return false;
  return ["UPDATE_AGENT", "UPDATE_SKILL", "UPDATE_THESIS", "UPDATE_REFERENCE"].includes(proposalType) || proposalType.startsWith("ADMIN_");
}

/** Alvo único da revisão (o banco garante exatamente um). */
export function targetOf(row: Pick<ReviewRow, "document_version_id" | "legal_analysis_id" | "agent_proposal_id">): { kind: ReviewTargetKind; id: string } {
  if (row.legal_analysis_id) return { kind: "ANALYSIS", id: row.legal_analysis_id };
  if (row.document_version_id) return { kind: "DOCUMENT_VERSION", id: row.document_version_id };
  return { kind: "AGENT_PROPOSAL", id: row.agent_proposal_id ?? "" };
}

/** Decisões do front → banco (APPROVED → APPROVE…). */
export function decisionToDb(decision: ReviewDecisionKind): Exclude<DbReviewDecision, "REOPEN"> {
  return REVIEW_DECISION_TO_DB[decision];
}

/** Filtro de status da listagem → lista de status do banco. */
export function statusFilterToDb(filter: string | undefined): DbReviewStatus[] | undefined {
  if (!filter) return undefined;
  return filter === "OPEN" ? ["PENDING", "REOPENED"] : [filter as DbReviewStatus];
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

export function listItemFromRow(row: ReviewRow): ReviewListItem {
  const target = targetOf(row);
  const proposalType = one(row.agent_proposals)?.proposal_type;
  return {
    id: row.id,
    targetKind: target.kind,
    targetId: target.id,
    proposalType,
    requiresAdmin: requiresAdminDecision(proposalType),
    legalCaseId: opt(row.legal_case_id),
    processId: opt(row.legal_process_id),
    status: reviewStatusFromDb(row.status, row.priority),
    dbStatus: row.status,
    priority: row.priority,
    assignedReviewerId: opt(row.assigned_reviewer_id),
    dueAt: opt(row.due_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: opt(row.decided_at),
  };
}

export function decisionFromRow(row: ReviewDecisionRow): ReviewDecisionDTO {
  return {
    id: row.id,
    decision: reviewDecisionFromDb(row.decision),
    dbDecision: row.decision,
    notes: opt(row.notes),
    decidedById: row.decided_by,
    at: row.created_at,
  };
}

export function analysisTargetFromRow(row: AnalysisTargetRow): ReviewTargetDTO {
  return {
    kind: "ANALYSIS",
    analysisId: row.id,
    analysisStatus: row.status,
    templateId: row.analysis_template_id,
    agentRunId: opt(row.agent_run_id),
    result: resultFromRow(row.summary, row.result_data),
    resultData: isObject(row.result_data) ? row.result_data : {},
  };
}

export function documentVersionTargetFromRow(row: DocumentVersionTargetRow): ReviewTargetDTO | null {
  const doc = one(row.documents);
  if (!doc) return null;
  return {
    kind: "DOCUMENT_VERSION",
    documentVersionId: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    title: doc.title,
    category: doc.category,
    visibility: doc.visibility,
    originalFilename: opt(row.original_filename),
    mimeType: opt(row.mime_type),
    source: row.source,
    createdAt: row.created_at,
  };
}

export function proposalTargetFromRow(row: ProposalTargetRow): ReviewTargetDTO {
  return {
    kind: "AGENT_PROPOSAL",
    proposalId: row.id,
    agentRunId: row.agent_run_id,
    proposalType: row.proposal_type,
    proposalStatus: row.status,
    payload: isObject(row.payload) ? row.payload : {},
    requiresHumanReview: row.requires_human_review,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Domínio → atualização (só as colunas com grant)                     */
/* ------------------------------------------------------------------ */

/** Só responsável, prioridade e prazo: status/decided_at NUNCA entram aqui (o banco não tem grant para eles). */
export function assignPayload(input: AssignReviewInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.assignedReviewerId !== undefined) out.assigned_reviewer_id = input.assignedReviewerId;
  if (input.priority !== undefined) out.priority = input.priority;
  if (input.dueAt !== undefined) out.due_at = input.dueAt;
  return out;
}
