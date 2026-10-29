import type { SupabaseClient } from "@supabase/supabase-js";
import { unwrap } from "@/server/core/db-errors";

/**
 * Acesso a dados da área DG Brasil. Leitura direta das tabelas de
 * configuração (a RLS só deixa ADMIN ler: 016); escrita SEMPRE pelas RPCs
 * atômicas e idempotentes da 039 (dg_save_*_once), nunca por insert/update
 * solto — versão, vínculos e situação mudam juntos ou não mudam.
 */

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  purpose: string | null;
  status: string;
  current_version_id: string | null;
  updated_at: string;
}
export interface AgentVersionRow {
  id: string;
  agent_id: string;
  version_number: number;
  configuration: unknown;
  instructions?: string;
  created_at: string;
  created_by: string | null;
}
export interface SkillRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  current_version_id: string | null;
  updated_at: string;
}
export interface SkillVersionRow {
  id: string;
  skill_id: string;
  version_number: number;
  instructions?: string;
  created_at: string;
  created_by: string | null;
}
export interface SkillFileRow {
  skill_version_id: string;
  path: string;
  mime_type: string;
  file_size: number;
  checksum_sha256: string;
}
export interface ThesisRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  legal_area_id: string;
  status: string;
  current_version_id: string | null;
  updated_at: string;
  legal_areas: { name: string } | { name: string }[] | null;
}
export interface ThesisVersionRow {
  id: string;
  legal_thesis_id: string;
  version_number: number;
  foundations: string | null;
  application_criteria: string | null;
  exclusion_criteria: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}
export interface ReferenceRow {
  id: string;
  type: string;
  title: string;
  description: string | null;
  legal_area_id: string | null;
  tags: string[];
  status: string;
  current_version_id: string | null;
  updated_at: string;
}
export interface ReferenceVersionRow {
  id: string;
  reference_material_id: string;
  version_number: number;
  storage_object_name: string | null;
  content_text?: string | null;
  has_text?: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}
export interface BindingRow {
  a: string;
  b: string;
}

const rows = <T>(r: { data: unknown; error: unknown }) => (unwrap(r as never) ?? []) as T[];

export async function listAgents(db: SupabaseClient): Promise<AgentRow[]> {
  return rows<AgentRow>(await db.from("agents").select("id, slug, name, description, purpose, status, current_version_id, updated_at").is("deleted_at", null).order("name"));
}

export async function getAgent(db: SupabaseClient, id: string): Promise<AgentRow | null> {
  return (unwrap(await db.from("agents").select("id, slug, name, description, purpose, status, current_version_id, updated_at").eq("id", id).is("deleted_at", null).maybeSingle()) ?? null) as AgentRow | null;
}

export async function agentVersionsByIds(db: SupabaseClient, ids: string[], withInstructions = false): Promise<AgentVersionRow[]> {
  if (!ids.length) return [];
  const cols = `id, agent_id, version_number, configuration, created_at, created_by${withInstructions ? ", instructions" : ""}`;
  return rows<AgentVersionRow>(await db.from("agent_versions").select(cols).in("id", ids));
}

export async function agentVersions(db: SupabaseClient, agentId: string): Promise<AgentVersionRow[]> {
  return rows<AgentVersionRow>(await db.from("agent_versions").select("id, agent_id, version_number, configuration, created_at, created_by").eq("agent_id", agentId).order("version_number", { ascending: false }));
}

export async function listSkills(db: SupabaseClient): Promise<SkillRow[]> {
  return rows<SkillRow>(await db.from("skills").select("id, slug, name, description, status, current_version_id, updated_at").is("deleted_at", null).order("name"));
}

export async function getSkill(db: SupabaseClient, id: string): Promise<SkillRow | null> {
  return (unwrap(await db.from("skills").select("id, slug, name, description, status, current_version_id, updated_at").eq("id", id).is("deleted_at", null).maybeSingle()) ?? null) as SkillRow | null;
}

export async function skillVersions(db: SupabaseClient, skillId: string): Promise<SkillVersionRow[]> {
  return rows<SkillVersionRow>(await db.from("skill_versions").select("id, skill_id, version_number, created_at, created_by").eq("skill_id", skillId).order("version_number", { ascending: false }));
}

export async function skillVersionsByIds(db: SupabaseClient, ids: string[], withInstructions = false): Promise<SkillVersionRow[]> {
  if (!ids.length) return [];
  return rows<SkillVersionRow>(await db.from("skill_versions").select(`id, skill_id, version_number, created_at, created_by${withInstructions ? ", instructions" : ""}`).in("id", ids));
}

export async function skillFiles(db: SupabaseClient, versionIds: string[]): Promise<SkillFileRow[]> {
  if (!versionIds.length) return [];
  return rows<SkillFileRow>(await db.from("skill_version_files").select("skill_version_id, path, mime_type, file_size, checksum_sha256").in("skill_version_id", versionIds).order("path"));
}

export async function listTheses(db: SupabaseClient): Promise<ThesisRow[]> {
  return rows<ThesisRow>(await db.from("legal_theses").select("id, slug, title, description, legal_area_id, status, current_version_id, updated_at, legal_areas(name)").is("deleted_at", null).order("title"));
}

export async function getThesis(db: SupabaseClient, id: string): Promise<ThesisRow | null> {
  return (unwrap(await db.from("legal_theses").select("id, slug, title, description, legal_area_id, status, current_version_id, updated_at, legal_areas(name)").eq("id", id).is("deleted_at", null).maybeSingle()) ?? null) as ThesisRow | null;
}

export async function thesisVersions(db: SupabaseClient, thesisId: string): Promise<ThesisVersionRow[]> {
  return rows<ThesisVersionRow>(await db.from("legal_thesis_versions").select("id, legal_thesis_id, version_number, foundations, application_criteria, exclusion_criteria, notes, created_at, created_by").eq("legal_thesis_id", thesisId).order("version_number", { ascending: false }));
}

export async function thesisVersionsByIds(db: SupabaseClient, ids: string[]): Promise<ThesisVersionRow[]> {
  if (!ids.length) return [];
  return rows<ThesisVersionRow>(await db.from("legal_thesis_versions").select("id, legal_thesis_id, version_number, foundations, application_criteria, exclusion_criteria, notes, created_at, created_by").in("id", ids));
}

export async function listReferences(db: SupabaseClient): Promise<ReferenceRow[]> {
  return rows<ReferenceRow>(await db.from("reference_materials").select("id, type, title, description, legal_area_id, tags, status, current_version_id, updated_at").is("deleted_at", null).order("title"));
}

export async function referenceVersionsByIds(db: SupabaseClient, ids: string[]): Promise<ReferenceVersionRow[]> {
  if (!ids.length) return [];
  return rows<ReferenceVersionRow>(await db.from("reference_material_versions").select("id, reference_material_id, version_number, storage_object_name, content_text, metadata, created_at, created_by").in("id", ids));
}

type BindingTable =
  | "agent_skill_bindings" | "agent_thesis_bindings" | "agent_reference_bindings"
  | "thesis_skill_bindings" | "thesis_reference_bindings" | "skill_reference_bindings";
const BINDING_COLUMNS: Record<BindingTable, [string, string]> = {
  agent_skill_bindings: ["agent_id", "skill_id"],
  agent_thesis_bindings: ["agent_id", "legal_thesis_id"],
  agent_reference_bindings: ["agent_id", "reference_material_id"],
  thesis_skill_bindings: ["legal_thesis_id", "skill_id"],
  thesis_reference_bindings: ["legal_thesis_id", "reference_material_id"],
  skill_reference_bindings: ["skill_id", "reference_material_id"],
};

/** Vínculos HABILITADOS de uma tabela de junção, como pares (a, b). */
export async function bindings(db: SupabaseClient, table: BindingTable): Promise<BindingRow[]> {
  const [a, b] = BINDING_COLUMNS[table];
  const data = rows<Record<string, string>>(await db.from(table).select(`${a}, ${b}`).eq("enabled", true));
  return data.map((r) => ({ a: r[a]!, b: r[b]! }));
}

export async function legalAreas(db: SupabaseClient): Promise<{ id: string; name: string }[]> {
  return rows(await db.from("legal_areas").select("id, name").order("name"));
}

export async function templates(db: SupabaseClient): Promise<{ id: string; name: string; active: boolean; primary_agent_id: string | null; legal_areas: { name: string } | { name: string }[] | null }[]> {
  return rows(await db.from("analysis_templates").select("id, name, active, primary_agent_id, legal_areas(name)").order("name"));
}

export async function profileNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const data = rows<{ id: string; full_name: string | null }>(await db.from("profiles").select("id, full_name").in("id", unique));
  return new Map(data.map((p) => [p.id, p.full_name ?? ""]));
}

/** Execuções recentes por agente (ADMIN lê agent_runs): última e contagem dos últimos 7 dias. */
export async function recentRuns(db: SupabaseClient, sinceIso: string): Promise<{ agent_id: string; created_at: string }[]> {
  return rows(await db.from("agent_runs").select("agent_id, created_at").gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(2000));
}

export async function lastRunPerAgent(db: SupabaseClient, agentIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(agentIds.map(async (id) => {
    const r = unwrap(await db.from("agent_runs").select("created_at").eq("agent_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle()) as { created_at: string } | null;
    if (r) out.set(id, r.created_at);
  }));
  return out;
}

export async function countSince(db: SupabaseClient, table: string, sinceIso: string): Promise<number> {
  const r = await db.from(table).select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
  unwrap({ data: null, error: r.error });
  return r.count ?? 0;
}

/** Versões recentes de uma tabela de versões (histórico). */
export async function recentVersions<T>(db: SupabaseClient, table: string, columns: string, limit: number): Promise<T[]> {
  return rows<T>(await db.from(table).select(columns).order("created_at", { ascending: false }).limit(limit));
}

/** Versão anterior (para a diferença). */
export async function previousVersion<T>(db: SupabaseClient, table: string, columns: string, parentColumn: string, parentId: string, number: number): Promise<T | null> {
  return (unwrap(await db.from(table).select(columns).eq(parentColumn, parentId).eq("version_number", number - 1).maybeSingle()) ?? null) as T | null;
}

/* ─── RPCs (039) ─────────────────────────────────────────────────────── */

const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown>) => unwrap(await db.rpc(fn, args)) as T;

export const saveAgent = (db: SupabaseClient, key: string, payload: Record<string, unknown>) =>
  rpc<Record<string, unknown>>(db, "dg_save_agent_once", { p_key: key, p_agent: payload });
export const setAgentStatus = (db: SupabaseClient, id: string, status: string) =>
  rpc<Record<string, unknown>>(db, "dg_set_agent_status", { p_agent_id: id, p_status: status });
export const saveThesis = (db: SupabaseClient, key: string, payload: Record<string, unknown>) =>
  rpc<Record<string, unknown>>(db, "dg_save_thesis_once", { p_key: key, p_thesis: payload });
export const saveReference = (db: SupabaseClient, key: string, payload: Record<string, unknown>) =>
  rpc<Record<string, unknown>>(db, "dg_save_reference_once", { p_key: key, p_ref: payload });
export const setTemplateAgent = (db: SupabaseClient, templateId: string, agentId: string | null) =>
  rpc<Record<string, unknown>>(db, "dg_set_template_agent", { p_template_id: templateId, p_agent_id: agentId });
export const aiStatus = (db: SupabaseClient) => rpc<Record<string, unknown>>(db, "get_ai_runtime_status", {});
export const setAiEnabled = (db: SupabaseClient, enabled: boolean, reason?: string) =>
  rpc<Record<string, unknown>>(db, "set_ai_execution_enabled", { p_enabled: enabled, p_reason: reason ?? null });
export const executorStatus = (db: SupabaseClient) => rpc<Record<string, unknown>>(db, "get_executor_status", {});
export const createExecutor = (db: SupabaseClient, name: string, tokenHash: string, tokenPrefix: string) =>
  rpc<Record<string, unknown>>(db, "dg_create_executor", { p_name: name, p_token_hash: tokenHash, p_token_prefix: tokenPrefix });
export const revokeExecutor = (db: SupabaseClient, id: string) => rpc<Record<string, unknown>>(db, "dg_revoke_executor", { p_executor_id: id });
