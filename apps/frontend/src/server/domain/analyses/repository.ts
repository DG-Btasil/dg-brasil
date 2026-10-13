import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentCategory } from "@/lib/constants/status";
import { fromDbError, unwrap } from "@/server/core/db-errors";
import { toRange, type PageInput } from "@/server/core/pagination";
import type { DbAnalysisStatus } from "@/repositories/api/db-mappings";
import type { AnalysisDetailRow, AnalysisRow, TemplateFieldRow, TemplateRequirementRow } from "./mappers";

/**
 * Acesso a dados de análise jurídica (legal_analyses: só ADMIN/LAWYER pela
 * RLS) e ao catálogo de templates (leitura de qualquer membro). Nunca chama
 * modelo de IA: a execução é pedida ao domínio de agentes.
 */

const LIST_COLUMNS = "id, legal_case_id, analysis_template_id, status, agent_run_id, started_at, completed_at, created_at, updated_at";
const DETAIL_COLUMNS = `${LIST_COLUMNS}, summary, field_values, result_data, interruption_reason, started_by`;

export async function list(
  db: SupabaseClient,
  filters: { legalCaseId?: string; status?: DbAnalysisStatus },
  page: PageInput,
  sort: { column: string; ascending: boolean },
): Promise<{ rows: AnalysisRow[]; total: number }> {
  let query = db.from("legal_analyses").select(LIST_COLUMNS, { count: "exact" });
  if (filters.legalCaseId) query = query.eq("legal_case_id", filters.legalCaseId);
  if (filters.status) query = query.eq("status", filters.status);
  const { from, to } = toRange(page);
  const { data, error, count } = await query.order(sort.column, { ascending: sort.ascending }).order("id").range(from, to);
  if (error) throw fromDbError(error);
  return { rows: (data ?? []) as AnalysisRow[], total: count ?? 0 };
}

export async function getById(db: SupabaseClient, id: string): Promise<AnalysisDetailRow | null> {
  return unwrap(await db.from("legal_analyses").select(DETAIL_COLUMNS).eq("id", id).maybeSingle()) as AnalysisDetailRow | null;
}

export interface CaseRow {
  id: string;
  legal_area_id: string;
  deleted_at: string | null;
  clients: { kind: "INDIVIDUAL" | "COMPANY" } | { kind: "INDIVIDUAL" | "COMPANY" }[] | null;
}

export async function getCase(db: SupabaseClient, caseId: string): Promise<CaseRow | null> {
  return unwrap(await db.from("legal_cases").select("id, legal_area_id, deleted_at, clients(kind)").eq("id", caseId).maybeSingle()) as CaseRow | null;
}

export interface TemplateRow {
  id: string;
  legal_area_id: string;
  active: boolean;
  primary_agent_id: string | null;
  analysis_template_fields: TemplateFieldRow[] | null;
  analysis_template_requirements: TemplateRequirementRow[] | null;
}

export async function getTemplate(db: SupabaseClient, id: string): Promise<TemplateRow | null> {
  return unwrap(
    await db
      .from("analysis_templates")
      .select(
        `id, legal_area_id, active, primary_agent_id,
         analysis_template_fields(key, label, field_type, required, options),
         analysis_template_requirements(document_category, label, description, required, applies_to_client_kind, sort_order)`,
      )
      .eq("id", id)
      .maybeSingle(),
  ) as TemplateRow | null;
}

/** Categorias já cumpridas no caso: documento vinculado (não excluído) ou pendência RECEIVED/APPROVED. */
export async function satisfiedCategories(db: SupabaseClient, caseId: string): Promise<Set<DocumentCategory>> {
  const [linked, requirements] = await Promise.all([
    db.from("case_documents").select("documents!inner(category, deleted_at)").eq("legal_case_id", caseId).is("documents.deleted_at", null),
    db.from("case_document_requirements").select("category").eq("legal_case_id", caseId).in("status", ["RECEIVED", "APPROVED"]),
  ]);
  const docs = (unwrap(linked) ?? []) as unknown as { documents: { category: DocumentCategory } | { category: DocumentCategory }[] }[];
  const reqs = (unwrap(requirements) ?? []) as { category: DocumentCategory }[];
  const out = new Set<DocumentCategory>();
  for (const d of docs) for (const doc of Array.isArray(d.documents) ? d.documents : [d.documents]) out.add(doc.category);
  for (const r of reqs) out.add(r.category);
  return out;
}

export async function latestReviewId(db: SupabaseClient, analysisId: string): Promise<string | null> {
  const data = unwrap(
    await db.from("reviews").select("id").eq("legal_analysis_id", analysisId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ) as { id: string } | null;
  return data?.id ?? null;
}

export async function insert(db: SupabaseClient, row: Record<string, unknown>): Promise<void> {
  unwrap(await db.from("legal_analyses").insert(row));
}

/** Liga a execução pedida e passa para a fila — só se o status ainda permitir (corrida: um ganha). */
export async function markQueued(db: SupabaseClient, id: string, agentRunId: string, userId: string, from: DbAnalysisStatus[]): Promise<number> {
  const { error, count } = await db
    .from("legal_analyses")
    .update(
      { status: "QUEUED", agent_run_id: agentRunId, started_by: userId, started_at: new Date().toISOString(), interruption_reason: null },
      { count: "exact" },
    )
    .eq("id", id)
    .in("status", from);
  if (error) throw fromDbError(error);
  return count ?? 0;
}
