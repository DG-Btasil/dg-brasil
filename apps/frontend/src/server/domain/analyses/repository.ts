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

const LIST_COLUMNS = "id, legal_case_id, analysis_template_id, status, agent_run_id, started_at, completed_at, created_at, updated_at, analysis_templates(name)";
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
  return (await latestReview(db, analysisId))?.id ?? null;
}

/** Revisão mais recente da análise, com a situação (resultado da IA aprovado ou não). */
export async function latestReview(db: SupabaseClient, analysisId: string): Promise<{ id: string; status: string } | null> {
  return unwrap(
    await db.from("reviews").select("id, status").eq("legal_analysis_id", analysisId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ) as { id: string; status: string } | null;
}

export interface TemplateSetupRow {
  id: string;
  name: string;
  description: string | null;
  primary_agent_id: string | null;
  analysis_template_fields: (TemplateFieldRow & { help_text: string | null; sort_order: number })[] | null;
  analysis_template_requirements: TemplateRequirementRow[] | null;
}

/** Templates ATIVOS de uma área, com campos e checklist (catálogo: leitura de qualquer membro). */
export async function listTemplates(db: SupabaseClient, legalAreaId: string): Promise<TemplateSetupRow[]> {
  return (unwrap(
    await db
      .from("analysis_templates")
      .select(
        `id, name, description, primary_agent_id,
         analysis_template_fields(key, label, field_type, required, options, help_text, sort_order),
         analysis_template_requirements(document_category, label, description, required, applies_to_client_kind, sort_order)`,
      )
      .eq("legal_area_id", legalAreaId)
      .eq("active", true)
      .order("name"),
  ) ?? []) as TemplateSetupRow[];
}

export interface AnalysisStartedRow {
  analysis_id: string;
  agent_run_id: string | null;
  deduplicated: boolean;
}

/**
 * Cria a análise e, com `send`, pede a execução e liga — numa transação,
 * idempotente (public.start_legal_analysis_once, 029).
 */
export async function startOnce(
  db: SupabaseClient,
  input: { key: string; legalCaseId: string; templateId: string; fields: Record<string, string>; send: boolean; requestText: string | null; requestId: string },
): Promise<AnalysisStartedRow> {
  return unwrap(
    await db.rpc("start_legal_analysis_once", {
      p_key: input.key,
      p_legal_case_id: input.legalCaseId,
      p_template_id: input.templateId,
      p_field_values: input.fields,
      p_send: input.send,
      p_request_text: input.requestText,
      // Só o correlation ID (UUID, sem PII): liga a execução à requisição que a pediu.
      p_parameters: { request_id: input.requestId },
    }),
  ) as AnalysisStartedRow;
}

/** Envia análise existente: execução + fila + QUEUED numa transação (public.send_legal_analysis_once, 029). */
export async function sendOnce(db: SupabaseClient, key: string, analysisId: string, requestText: string | null, requestId: string): Promise<AnalysisStartedRow> {
  return unwrap(
    await db.rpc("send_legal_analysis_once", { p_key: key, p_analysis_id: analysisId, p_request_text: requestText, p_parameters: { request_id: requestId } }),
  ) as AnalysisStartedRow;
}
