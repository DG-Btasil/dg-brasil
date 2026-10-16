import type { SupabaseClient } from "@supabase/supabase-js";
import type { Priority } from "@/lib/constants/status";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DbReviewDecision, DbReviewStatus } from "@/repositories/api/db-mappings";
import type { AnalysisTargetRow, DocumentVersionTargetRow, ProposalTargetRow, ReviewDecisionRow, ReviewRow } from "./mappers";

/**
 * Acesso a dados de revisão humana. GATE HUMANO: este arquivo NUNCA grava
 * reviews.status/decided_at nem insere em review_decisions — decisão é só
 * pela RPC decide_review (decisão → status → proposta → auditoria, numa
 * transação). A atualização direta cobre só as colunas com grant.
 */

/**
 * Colunas da revisão + rótulos de leitura do alvo e do caso (embeds; a RLS de
 * cada tabela vale — o que o usuário não vê volta nulo). Só nomes/títulos:
 * nenhum conteúdo revisado entra na listagem.
 */
const REVIEW_COLUMNS = `id, legal_case_id, legal_process_id, document_version_id, legal_analysis_id, agent_proposal_id,
  status, priority, assigned_reviewer_id, due_at, created_at, updated_at, decided_at,
  agent_proposals(proposal_type, agent_runs(agents(name))),
  legal_analyses(analysis_templates(name)),
  document_versions(version_number, documents(title)),
  legal_cases(title, clients!legal_cases_client_id_fkey(individual_client_details(full_name), company_client_details(legal_name)))`;

export interface ReviewFilters {
  statuses?: DbReviewStatus[];
  priority?: Priority;
  assignee?: { kind: "user"; id: string } | { kind: "unassigned" };
  legalCaseId?: string;
  processId?: string;
  targetKind?: "DOCUMENT_VERSION" | "ANALYSIS" | "AGENT_PROPOSAL";
}

const TARGET_COLUMN = { DOCUMENT_VERSION: "document_version_id", ANALYSIS: "legal_analysis_id", AGENT_PROPOSAL: "agent_proposal_id" } as const;

export async function list(
  db: SupabaseClient,
  filters: ReviewFilters,
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: ReviewRow[]; total: number }> {
  let query = db.from("reviews").select(REVIEW_COLUMNS, { count: "exact" });
  if (filters.statuses) query = query.in("status", filters.statuses);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.assignee?.kind === "user") query = query.eq("assigned_reviewer_id", filters.assignee.id);
  if (filters.assignee?.kind === "unassigned") query = query.is("assigned_reviewer_id", null);
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.processId) query = query.eq("legal_process_id", filters.processId);
  if (filters.targetKind) query = query.not(TARGET_COLUMN[filters.targetKind], "is", null);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as unknown as ReviewRow[], total: count ?? 0 };
}

export async function getById(db: SupabaseClient, id: string): Promise<ReviewRow | null> {
  return unwrap(await db.from("reviews").select(REVIEW_COLUMNS).eq("id", id).maybeSingle()) as unknown as ReviewRow | null;
}

export async function listDecisions(db: SupabaseClient, reviewId: string): Promise<ReviewDecisionRow[]> {
  return (unwrap(
    await db.from("review_decisions").select("id, decision, notes, decided_by, created_at").eq("review_id", reviewId).order("created_at").order("id"),
  ) ?? []) as ReviewDecisionRow[];
}

/* ------------------------------------------------------------------ */
/* Alvo da revisão (o conteúdo vem daqui, nunca duplicado na revisão)  */
/* ------------------------------------------------------------------ */

export async function getAnalysisTarget(db: SupabaseClient, id: string): Promise<AnalysisTargetRow | null> {
  return unwrap(
    await db.from("legal_analyses").select("id, status, analysis_template_id, agent_run_id, summary, result_data").eq("id", id).maybeSingle(),
  ) as AnalysisTargetRow | null;
}

export async function getDocumentVersionTarget(db: SupabaseClient, id: string): Promise<DocumentVersionTargetRow | null> {
  return unwrap(
    await db
      .from("document_versions")
      .select("id, document_id, version_number, original_filename, mime_type, file_size, storage_object_name, source, created_at, documents(title, category, visibility, status)")
      .eq("id", id)
      .maybeSingle(),
  ) as unknown as DocumentVersionTargetRow | null;
}

export async function getProposalTarget(db: SupabaseClient, id: string): Promise<ProposalTargetRow | null> {
  return unwrap(
    await db.from("agent_proposals").select("id, agent_run_id, proposal_type, status, payload, requires_human_review, created_at").eq("id", id).maybeSingle(),
  ) as ProposalTargetRow | null;
}

/* ------------------------------------------------------------------ */
/* Escrita                                                             */
/* ------------------------------------------------------------------ */

/** Papel interno ATIVO do usuário (para validar o revisor atribuído). null = não é revisor possível. */
export async function internalRole(db: SupabaseClient, userId: string): Promise<string | null> {
  const data = unwrap(
    await db
      .from("organization_memberships")
      .select("role, organizations!inner(type, status)")
      .eq("user_id", userId)
      .eq("status", "ACTIVE")
      .eq("organizations.type", "OWNER")
      .eq("organizations.status", "ACTIVE")
      .limit(1)
      .maybeSingle(),
  ) as { role: string } | null;
  return data?.role ?? null;
}

/** Atribuição/prioridade/prazo — só colunas com grant de UPDATE. Devolve linhas alteradas. */
export async function assign(db: SupabaseClient, id: string, payload: Record<string, unknown>, openStatuses: DbReviewStatus[]): Promise<number> {
  const { error, count } = await db.from("reviews").update(payload, { count: "exact" }).eq("id", id).in("status", openStatuses);
  if (error) throw fromDbError(error);
  return count ?? 0;
}

/** A ÚNICA porta de decisão: RPC decide_review (o banco valida papel, transição e proposta estrutural). */
export async function decide(db: SupabaseClient, reviewId: string, decision: DbReviewDecision, notes: string | null): Promise<string> {
  return unwrap(await db.rpc("decide_review", { p_review_id: reviewId, p_decision: decision, p_notes: notes })) as string;
}

/* ------------------------------------------------------------------ */
/* Edição manual (034)                                                 */
/* ------------------------------------------------------------------ */

export interface PreparedRevisionRow {
  deduplicated: boolean;
  document_version_id: string;
  object_name?: string;
  mime_type?: string;
  base_version_number?: number;
  version_number?: number;
  review_id?: string;
  previous_review_id?: string;
}

export interface CommittedRevisionRow {
  deduplicated: boolean;
  document_version_id: string;
  version_number: number;
  review_id: string;
  previous_review_id: string;
}

/** Confere a edição e devolve o caminho EXATO da versão N+1 (ou o resultado anterior da mesma chave). */
export async function prepareManualRevision(db: SupabaseClient, key: string, reviewId: string, baseVersionId: string): Promise<PreparedRevisionRow> {
  return unwrap(await db.rpc("prepare_manual_revision", { p_key: key, p_review_id: reviewId, p_base_version_id: baseVersionId })) as PreparedRevisionRow;
}

/** Versão N+1 + decisão da revisão N + revisão nova + auditoria, numa transação (034). */
export async function commitManualRevision(
  db: SupabaseClient,
  params: { key: string; reviewId: string; baseVersionId: string; versionId: string; objectName: string; size: number; checksum: string },
): Promise<CommittedRevisionRow> {
  return unwrap(
    await db.rpc("commit_manual_revision_once", {
      p_key: params.key,
      p_review_id: params.reviewId,
      p_base_version_id: params.baseVersionId,
      p_new_version_id: params.versionId,
      p_object_name: params.objectName,
      p_file_size: params.size,
      p_checksum: params.checksum,
    }),
  ) as CommittedRevisionRow;
}

/** Número da versão mais recente do documento (RLS de quem pergunta). */
export async function latestVersionNumber(db: SupabaseClient, documentId: string): Promise<number | null> {
  const data = unwrap(
    await db.from("document_versions").select("version_number").eq("document_id", documentId).order("version_number", { ascending: false }).limit(1).maybeSingle(),
  ) as { version_number: number } | null;
  return data?.version_number ?? null;
}
