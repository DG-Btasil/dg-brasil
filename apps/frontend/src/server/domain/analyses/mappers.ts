import { analysisStatusFromDb, type DbAnalysisStatus } from "@/repositories/api/db-mappings";
import type { DocumentCategory } from "@/lib/constants/status";
import type { FieldErrors } from "@/server/core/errors";
import type { AnalysisResult } from "@/types";
import type { AnalysisDetailDTO, AnalysisListItem, AnalysisTemplateSetupDTO, MissingRequirementDTO } from "./dto";
import type { TemplateSetupRow } from "./repository";

/**
 * Banco ↔ domínio da análise jurídica. Funções puras, testadas em
 * analyses.test.ts: status do front, resultado estruturado, checklist de
 * documentos e validação dos campos contra a definição do template.
 */

/* ------------------------------------------------------------------ */
/* Linhas do banco                                                     */
/* ------------------------------------------------------------------ */

export interface AnalysisRow {
  id: string;
  legal_case_id: string;
  analysis_template_id: string;
  status: DbAnalysisStatus;
  agent_run_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  analysis_templates?: { name: string } | { name: string }[] | null;
}

export interface AnalysisDetailRow extends AnalysisRow {
  summary: string | null;
  field_values: Record<string, unknown> | null;
  result_data: unknown;
  interruption_reason: string | null;
  started_by: string | null;
}

export interface TemplateFieldRow {
  key: string;
  label: string;
  field_type: "text" | "textarea" | "number" | "currency" | "date" | "select" | "boolean";
  required: boolean;
  options: { value: string; label: string }[] | null;
}

export interface TemplateRequirementRow {
  document_category: DocumentCategory;
  label: string;
  description: string | null;
  required: boolean;
  applies_to_client_kind: "INDIVIDUAL" | "COMPANY" | null;
  sort_order: number;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------ */
/* Checklist de documentos                                             */
/* ------------------------------------------------------------------ */

/**
 * Itens do template que o caso ainda não cumpre. Vale o item para o tipo de
 * cliente (PF/PJ) ou para ambos. Categoria cumprida = documento vinculado ao
 * caso ou pendência do caso RECEIVED/APPROVED.
 */
export function missingRequirements(
  requirements: TemplateRequirementRow[],
  clientKind: "INDIVIDUAL" | "COMPANY",
  satisfied: ReadonlySet<DocumentCategory>,
): MissingRequirementDTO[] {
  return [...requirements]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter((r) => (r.applies_to_client_kind === null || r.applies_to_client_kind === clientKind) && !satisfied.has(r.document_category))
    .map((r) => ({ category: r.document_category, label: r.label, description: opt(r.description), required: r.required }));
}

/** Template → assistente: campos ordenados e checklist do tipo de cliente, com o que já está cumprido. */
export function templateSetupFromRow(row: TemplateSetupRow, clientKind: "INDIVIDUAL" | "COMPANY", satisfied: ReadonlySet<DocumentCategory>): AnalysisTemplateSetupDTO {
  return {
    id: row.id,
    name: row.name,
    description: opt(row.description),
    hasAgent: !!row.primary_agent_id,
    fields: [...(row.analysis_template_fields ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({ key: f.key, label: f.label, type: f.field_type, required: f.required, helpText: opt(f.help_text), options: opt(f.options) })),
    requirements: [...(row.analysis_template_requirements ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .filter((r) => r.applies_to_client_kind === null || r.applies_to_client_kind === clientKind)
      .map((r) => ({ category: r.document_category, label: r.label, description: opt(r.description), required: r.required, satisfied: satisfied.has(r.document_category) })),
  };
}

/* ------------------------------------------------------------------ */
/* Campos do template                                                  */
/* ------------------------------------------------------------------ */

/** Confere as respostas contra a definição do template. Devolve erros por campo (`fields.<key>`) ou null. */
export function validateTemplateFields(values: Record<string, string>, fields: TemplateFieldRow[]): FieldErrors | null {
  const errors: FieldErrors = {};
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const add = (key: string, message: string) => (errors[`fields.${key}`] ??= []).push(message);

  for (const key of Object.keys(values)) if (!byKey.has(key)) add(key, "Campo não pertence a este template.");
  for (const f of fields) {
    const value = values[f.key]?.trim() ?? "";
    if (!value) {
      if (f.required) add(f.key, `Informe ${f.label}.`);
      continue;
    }
    if ((f.field_type === "number" || f.field_type === "currency") && !/^-?\d+([.,]\d+)?$/.test(value)) add(f.key, "Número inválido.");
    if (f.field_type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) add(f.key, "Data inválida.");
    if (f.field_type === "boolean" && value !== "true" && value !== "false") add(f.key, "Use sim ou não.");
    if (f.field_type === "select" && !(f.options ?? []).some((o) => o.value === value)) add(f.key, "Opção inválida.");
  }
  return Object.keys(errors).length ? errors : null;
}

/** Só os campos do template, com texto aparado; vazio não é gravado. */
export function fieldValuesPayload(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ""));
}

/* ------------------------------------------------------------------ */
/* Banco → domínio                                                     */
/* ------------------------------------------------------------------ */

export function listItemFromRow(row: AnalysisRow): AnalysisListItem {
  return {
    id: row.id,
    legalCaseId: row.legal_case_id,
    templateId: row.analysis_template_id,
    templateName: (Array.isArray(row.analysis_templates) ? row.analysis_templates[0] : row.analysis_templates)?.name ?? "",
    dbStatus: row.status,
    agentRunId: opt(row.agent_run_id),
    startedAt: opt(row.started_at),
    completedAt: opt(row.completed_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Resultado estruturado (result_data + summary). Sem resultado ainda → undefined. */
export function resultFromRow(summary: string | null, resultData: unknown): AnalysisResult | undefined {
  const data = isObject(resultData) ? resultData : {};
  const theses = Array.isArray(data.identified_thesis_ids) ? data.identified_thesis_ids.filter((t): t is string => typeof t === "string" && UUID.test(t)) : [];
  const recommendation = typeof data.recommendation === "string" ? data.recommendation : "";
  if (!summary && theses.length === 0 && !recommendation) return undefined;
  return { summary: summary ?? "", identifiedThesisIds: theses, recommendation };
}

function stringFields(values: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values ?? {})) if (v !== null && v !== undefined) out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

export function detailFromRow(row: AnalysisDetailRow, missing: MissingRequirementDTO[], reviewId: string | null): AnalysisDetailDTO {
  const requiredDocumentsComplete = !missing.some((m) => m.required);
  return {
    ...listItemFromRow(row),
    status: analysisStatusFromDb(row.status, requiredDocumentsComplete),
    fields: stringFields(row.field_values),
    result: resultFromRow(row.summary, row.result_data),
    resultData: isObject(row.result_data) ? row.result_data : {},
    interruptionReason: opt(row.interruption_reason),
    startedById: opt(row.started_by),
    missingRequirements: missing,
    requiredDocumentsComplete,
    reviewId: opt(reviewId),
  };
}
