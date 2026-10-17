import { randomUUID } from "node:crypto";
import { skillFileMime, REFERENCE_FILE_TYPES } from "@/lib/constants/ai";
import type { AgentStatus, ReferenceMaterialStatus, ReferenceMaterialType, SkillStatus, ThesisStatus } from "@/lib/constants/status";
import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { DomainError, notFound } from "@/server/core/errors";
import type {
  AgentDetailDTO, AgentListItemDTO, AiRuntimeStatusDTO, AiUsageDTO, AiUsageRow, DgCatalogDTO, DgOverviewDTO, HistoryEntryDTO,
  PreparedReferenceFileDTO, PreparedSkillFilesDTO, ReferenceItemDTO, SaveResultDTO, SkillDetailDTO, SkillListItemDTO,
  ThesisDetailDTO, ThesisListItemDTO, VersionItemDTO,
} from "./dto";
import { agentStatusFromDb, agentStatusToDb, agentVersionText, configFromDb, configToDb, lineDiff, skillVersionText, slugify, thesisText } from "./mappers";
import * as repo from "./repository";
import type { HistoryInput, PrepareReferenceFileInput, PrepareSkillFilesInput, SaveAgentInput, SaveReferenceInput, SaveSkillInput, SaveThesisInput } from "./schemas";
import { REFERENCE_BUCKET, SKILL_FILES_BUCKET, referenceObjectName, skillObjectName, signedDgStorage, type DgStorage } from "./storage";

/**
 * Área DG Brasil (só ADMIN): agentes, skills (com arquivos), teses,
 * referências, histórico de versões e o interruptor/uso da IA. Tudo real,
 * do banco. Nenhuma função aqui chama IA: configura o que o worker executa.
 */

function requireAdmin(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "dgbrasil.manage");
}

const invalido = (message: string) => new DomainError("VALIDATION", message);
const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

function pairs(rows: repo.BindingRow[]) {
  const byA = new Map<string, string[]>();
  const byB = new Map<string, string[]>();
  for (const r of rows) {
    byA.set(r.a, [...(byA.get(r.a) ?? []), r.b]);
    byB.set(r.b, [...(byB.get(r.b) ?? []), r.a]);
  }
  return { byA, byB };
}

function versions(rows: { id: string; version_number: number; created_at: string; created_by: string | null }[], names: Map<string, string>): VersionItemDTO[] {
  return rows.map((v) => ({ id: v.id, number: v.version_number, createdAt: v.created_at, createdByName: (v.created_by && names.get(v.created_by)) || undefined }));
}

/* ─── visão geral e catálogos ───────────────────────────────────────── */

export async function overview(ctx: ServiceContext): Promise<DgOverviewDTO> {
  requireAdmin(ctx);
  const since30 = daysAgo(30);
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const [agents, skills, theses, ...counts] = await Promise.all([
    repo.listAgents(ctx.db), repo.listSkills(ctx.db), repo.listTheses(ctx.db),
    repo.countSince(ctx.db, "agent_versions", since30), repo.countSince(ctx.db, "skill_versions", since30),
    repo.countSince(ctx.db, "legal_thesis_versions", since30), repo.countSince(ctx.db, "reference_material_versions", since30),
    repo.countSince(ctx.db, "agent_runs", month.toISOString()),
  ]);
  return {
    activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
    totalAgents: agents.length,
    activeSkills: skills.filter((s) => s.status === "ACTIVE").length,
    activeTheses: theses.filter((t) => t.status === "ACTIVE").length,
    changesLast30Days: counts.slice(0, 4).reduce((a, b) => a + b, 0),
    monthRuns: counts[4] ?? 0,
  };
}

export async function catalog(ctx: ServiceContext): Promise<DgCatalogDTO> {
  requireAdmin(ctx);
  const [agents, skills, theses, references, areas, templates] = await Promise.all([
    repo.listAgents(ctx.db), repo.listSkills(ctx.db), repo.listTheses(ctx.db), repo.listReferences(ctx.db),
    repo.legalAreas(ctx.db), repo.templates(ctx.db),
  ]);
  return {
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    skills: skills.map((s) => ({ id: s.id, name: s.name })),
    theses: theses.map((t) => ({ id: t.id, name: t.title })),
    references: references.map((r) => ({ id: r.id, name: r.title })),
    legalAreas: areas,
    templates: templates.map((t) => ({ id: t.id, name: t.name, legalAreaName: one(t.legal_areas)?.name ?? "", active: t.active, agentId: opt(t.primary_agent_id) })),
  };
}

/* ─── agentes ────────────────────────────────────────────────────────── */

export async function listAgents(ctx: ServiceContext): Promise<AgentListItemDTO[]> {
  requireAdmin(ctx);
  const [agents, skillB, thesisB, runs] = await Promise.all([
    repo.listAgents(ctx.db), repo.bindings(ctx.db, "agent_skill_bindings"), repo.bindings(ctx.db, "agent_thesis_bindings"),
    repo.recentRuns(ctx.db, daysAgo(7)),
  ]);
  const [vers, last] = await Promise.all([
    repo.agentVersionsByIds(ctx.db, agents.map((a) => a.current_version_id).filter((v): v is string => !!v)),
    repo.lastRunPerAgent(ctx.db, agents.map((a) => a.id)),
  ]);
  const vById = new Map(vers.map((v) => [v.id, v]));
  const skills = pairs(skillB).byA;
  const theses = pairs(thesisB).byA;
  return agents.map((a) => {
    const v = a.current_version_id ? vById.get(a.current_version_id) : undefined;
    const cfg = configFromDb(v?.configuration);
    return {
      id: a.id, slug: a.slug, name: a.name, description: opt(a.description), purpose: opt(a.purpose),
      status: agentStatusFromDb(a.status), version: v?.version_number ?? 0, model: cfg.model, codeExecution: cfg.codeExecution,
      skillCount: skills.get(a.id)?.length ?? 0, thesisCount: theses.get(a.id)?.length ?? 0,
      lastRunAt: last.get(a.id), runsLast7Days: runs.filter((r) => r.agent_id === a.id).length, updatedAt: a.updated_at,
    };
  });
}

export async function getAgent(ctx: ServiceContext, id: string): Promise<AgentDetailDTO> {
  requireAdmin(ctx);
  const a = await repo.getAgent(ctx.db, id);
  if (!a) throw notFound("Agente não encontrado.");
  const [allVersions, current, skillB, thesisB, refB, tpl, last, runs] = await Promise.all([
    repo.agentVersions(ctx.db, id),
    a.current_version_id ? repo.agentVersionsByIds(ctx.db, [a.current_version_id], true) : Promise.resolve([]),
    repo.bindings(ctx.db, "agent_skill_bindings"), repo.bindings(ctx.db, "agent_thesis_bindings"), repo.bindings(ctx.db, "agent_reference_bindings"),
    repo.templates(ctx.db), repo.lastRunPerAgent(ctx.db, [id]), repo.recentRuns(ctx.db, daysAgo(7)),
  ]);
  const v = current[0];
  const names = await repo.profileNames(ctx.db, allVersions.map((x) => x.created_by ?? ""));
  const cfg = configFromDb(v?.configuration);
  const skillIds = pairs(skillB).byA.get(id) ?? [];
  const thesisIds = pairs(thesisB).byA.get(id) ?? [];
  return {
    id: a.id, slug: a.slug, name: a.name, description: opt(a.description), purpose: opt(a.purpose),
    status: agentStatusFromDb(a.status), version: v?.version_number ?? 0, model: cfg.model, codeExecution: cfg.codeExecution,
    skillCount: skillIds.length, thesisCount: thesisIds.length, lastRunAt: last.get(id),
    runsLast7Days: runs.filter((r) => r.agent_id === id).length, updatedAt: a.updated_at,
    versionId: v?.id, instructions: v?.instructions ?? "", config: cfg, versions: versions(allVersions, names),
    skillIds, thesisIds, referenceIds: pairs(refB).byA.get(id) ?? [],
    templates: tpl.filter((t) => t.primary_agent_id === id).map((t) => ({ id: t.id, name: t.name })),
  };
}

function toSaveResult(r: Record<string, unknown>, idKey: string): SaveResultDTO {
  return {
    id: String(r[idKey]),
    versionNumber: typeof r.version_number === "number" ? r.version_number : undefined,
    versionCreated: r.version_created === true,
    created: r.created === true,
    deduplicated: r.deduplicated === true,
  };
}

export async function saveAgent(ctx: ServiceContext, input: SaveAgentInput): Promise<SaveResultDTO> {
  requireAdmin(ctx);
  const payload: Record<string, unknown> = {
    ...(input.id ? { id: input.id } : { slug: slugify(input.name, input.key.slice(0, 6)) }),
    name: input.name,
    description: input.description ?? "",
    purpose: input.purpose ?? "",
    status: agentStatusToDb(input.status),
    instructions: input.instructions,
    configuration: configToDb(input.config),
    skill_ids: input.skillIds,
    thesis_ids: input.thesisIds,
    reference_ids: input.referenceIds,
  };
  const r = toSaveResult(await repo.saveAgent(ctx.db, input.key, payload), "agent_id");
  ctx.log.info("dg.agent_saved", { agentId: r.id, versionCreated: r.versionCreated, created: r.created });
  return r;
}

export async function setAgentStatus(ctx: ServiceContext, id: string, status: AgentStatus): Promise<void> {
  requireAdmin(ctx);
  await repo.setAgentStatus(ctx.db, id, agentStatusToDb(status));
  ctx.log.info("dg.agent_status", { agentId: id, status });
}

export async function setTemplateAgent(ctx: ServiceContext, templateId: string, agentId: string | null): Promise<void> {
  requireAdmin(ctx);
  await repo.setTemplateAgent(ctx.db, templateId, agentId);
}

/* ─── skills ─────────────────────────────────────────────────────────── */

export async function listSkills(ctx: ServiceContext): Promise<SkillListItemDTO[]> {
  requireAdmin(ctx);
  const [skills, b] = await Promise.all([repo.listSkills(ctx.db), repo.bindings(ctx.db, "agent_skill_bindings")]);
  const ids = skills.map((s) => s.current_version_id).filter((v): v is string => !!v);
  const [vers, files] = await Promise.all([repo.skillVersionsByIds(ctx.db, ids), repo.skillFiles(ctx.db, ids)]);
  const vById = new Map(vers.map((v) => [v.id, v]));
  const agents = pairs(b).byB;
  return skills.map((s) => ({
    id: s.id, slug: s.slug, name: s.name, description: opt(s.description), status: s.status as SkillStatus,
    version: (s.current_version_id && vById.get(s.current_version_id)?.version_number) || 0,
    fileCount: files.filter((f) => f.skill_version_id === s.current_version_id).length,
    agentIds: agents.get(s.id) ?? [], updatedAt: s.updated_at,
  }));
}

export async function getSkill(ctx: ServiceContext, id: string): Promise<SkillDetailDTO> {
  requireAdmin(ctx);
  const s = await repo.getSkill(ctx.db, id);
  if (!s) throw notFound("Skill não encontrada.");
  const vid = s.current_version_id;
  const [all, current, files, b, registered] = await Promise.all([
    repo.skillVersions(ctx.db, id),
    vid ? repo.skillVersionsByIds(ctx.db, [vid], true) : Promise.resolve([]),
    vid ? repo.skillFiles(ctx.db, [vid]) : Promise.resolve([]),
    repo.bindings(ctx.db, "agent_skill_bindings"),
    vid ? repo.skillProviderRegistered(ctx.db, vid) : Promise.resolve(false),
  ]);
  const names = await repo.profileNames(ctx.db, all.map((v) => v.created_by ?? ""));
  return {
    id: s.id, slug: s.slug, name: s.name, description: opt(s.description), status: s.status as SkillStatus,
    version: current[0]?.version_number ?? 0, fileCount: files.length, agentIds: pairs(b).byB.get(id) ?? [], updatedAt: s.updated_at,
    versionId: opt(vid), instructions: current[0]?.instructions ?? "",
    files: files.map((f) => ({ path: f.path, mimeType: f.mime_type, size: Number(f.file_size), sha256: f.checksum_sha256 })),
    versions: versions(all, names), providerRegistered: registered,
  };
}

/**
 * Pede as URLs de envio dos arquivos novos de uma versão de skill. O id da
 * versão (e da skill, se nova) nasce AQUI: o caminho no bucket é montado pelo
 * servidor, nunca pelo navegador.
 */
export async function prepareSkillFiles(ctx: ServiceContext, input: PrepareSkillFilesInput, storage: DgStorage = signedDgStorage()): Promise<PreparedSkillFilesDTO> {
  requireAdmin(ctx);
  if (input.skillId && !(await repo.getSkill(ctx.db, input.skillId))) throw notFound("Skill não encontrada.");
  const paths = new Set<string>();
  for (const f of input.files) {
    if (paths.has(f.path)) throw invalido(`Arquivo repetido: ${f.path}`);
    paths.add(f.path);
    if (!skillFileMime(f.path)) throw invalido(`Tipo de arquivo não aceito: ${f.path}`);
  }
  const skillId = input.skillId ?? randomUUID();
  const versionId = randomUUID();
  const files = await Promise.all(input.files.map(async (f) => {
    const storageObjectName = skillObjectName(skillId, versionId, f.path);
    const { token } = await storage.createSignedUploadUrl(SKILL_FILES_BUCKET, storageObjectName);
    return { path: f.path, bucket: SKILL_FILES_BUCKET, storageObjectName, token, mimeType: skillFileMime(f.path)! };
  }));
  return { skillId, versionId, files };
}

export async function saveSkill(ctx: ServiceContext, input: SaveSkillInput): Promise<SaveResultDTO> {
  requireAdmin(ctx);
  for (const f of input.files) {
    if (f.storageObjectName !== skillObjectName(input.id, input.versionId ?? "", f.path)) throw invalido(`Arquivo fora do caminho da versão: ${f.path}`);
    if (skillFileMime(f.path) !== f.mimeType) throw invalido(`Tipo de arquivo inválido: ${f.path}`);
  }
  if (input.create && !input.slug) throw invalido("Informe o identificador da skill.");
  const payload: Record<string, unknown> = {
    id: input.id, create: input.create, version_id: input.versionId ?? null,
    ...(input.create ? { slug: input.slug } : {}),
    name: input.name, description: input.description, status: input.status, instructions: input.instructions, configuration: {},
    files: input.files.map((f) => ({ path: f.path, storage_object_name: f.storageObjectName, mime_type: f.mimeType, file_size: f.size, checksum_sha256: f.sha256 })),
    ...(input.keepPaths ? { keep_paths: input.keepPaths } : {}),
    ...(input.agentIds ? { agent_ids: input.agentIds } : {}),
  };
  const r = toSaveResult(await repo.saveSkill(ctx.db, input.key, payload), "skill_id");
  ctx.log.info("dg.skill_saved", { skillId: r.id, versionCreated: r.versionCreated, files: input.files.length });
  return r;
}

/* ─── teses ──────────────────────────────────────────────────────────── */

function thesisItem(t: repo.ThesisRow, version: number, agentIds: string[]): ThesisListItemDTO {
  return {
    id: t.id, slug: t.slug, title: t.title, description: opt(t.description), legalAreaId: t.legal_area_id,
    legalAreaName: one(t.legal_areas)?.name ?? "", status: t.status as ThesisStatus, version, agentIds, updatedAt: t.updated_at,
  };
}

export async function listTheses(ctx: ServiceContext): Promise<ThesisListItemDTO[]> {
  requireAdmin(ctx);
  const [theses, b] = await Promise.all([repo.listTheses(ctx.db), repo.bindings(ctx.db, "agent_thesis_bindings")]);
  const vers = await repo.thesisVersionsByIds(ctx.db, theses.map((t) => t.current_version_id).filter((v): v is string => !!v));
  const vById = new Map(vers.map((v) => [v.id, v.version_number]));
  const agents = pairs(b).byB;
  return theses.map((t) => thesisItem(t, (t.current_version_id && vById.get(t.current_version_id)) || 0, agents.get(t.id) ?? []));
}

export async function getThesis(ctx: ServiceContext, id: string): Promise<ThesisDetailDTO> {
  requireAdmin(ctx);
  const t = await repo.getThesis(ctx.db, id);
  if (!t) throw notFound("Tese não encontrada.");
  const [all, ab, sb, rb] = await Promise.all([
    repo.thesisVersions(ctx.db, id), repo.bindings(ctx.db, "agent_thesis_bindings"),
    repo.bindings(ctx.db, "thesis_skill_bindings"), repo.bindings(ctx.db, "thesis_reference_bindings"),
  ]);
  const cur = all.find((v) => v.id === t.current_version_id);
  const names = await repo.profileNames(ctx.db, all.map((v) => v.created_by ?? ""));
  return {
    ...thesisItem(t, cur?.version_number ?? 0, pairs(ab).byB.get(id) ?? []),
    foundations: opt(cur?.foundations), applicationCriteria: opt(cur?.application_criteria),
    exclusionCriteria: opt(cur?.exclusion_criteria), notes: opt(cur?.notes),
    versions: versions(all, names), skillIds: pairs(sb).byA.get(id) ?? [], referenceIds: pairs(rb).byA.get(id) ?? [],
  };
}

export async function saveThesis(ctx: ServiceContext, input: SaveThesisInput): Promise<SaveResultDTO> {
  requireAdmin(ctx);
  const payload: Record<string, unknown> = {
    ...(input.id ? { id: input.id } : { slug: slugify(input.title, input.key.slice(0, 6)) }),
    title: input.title, description: input.description ?? "", legal_area_id: input.legalAreaId, status: input.status,
    foundations: input.foundations ?? "", application_criteria: input.applicationCriteria ?? "",
    exclusion_criteria: input.exclusionCriteria ?? "", notes: input.notes ?? "",
    ...(input.agentIds ? { agent_ids: input.agentIds } : {}),
    ...(input.skillIds ? { skill_ids: input.skillIds } : {}),
    ...(input.referenceIds ? { reference_ids: input.referenceIds } : {}),
  };
  return toSaveResult(await repo.saveThesis(ctx.db, input.key, payload), "thesis_id");
}

/* ─── referências ────────────────────────────────────────────────────── */

export async function listReferences(ctx: ServiceContext): Promise<ReferenceItemDTO[]> {
  requireAdmin(ctx);
  const [refs, ab, sb, tb] = await Promise.all([
    repo.listReferences(ctx.db), repo.bindings(ctx.db, "agent_reference_bindings"),
    repo.bindings(ctx.db, "skill_reference_bindings"), repo.bindings(ctx.db, "thesis_reference_bindings"),
  ]);
  const vers = await repo.referenceVersionsByIds(ctx.db, refs.map((r) => r.current_version_id).filter((v): v is string => !!v));
  const vById = new Map(vers.map((v) => [v.id, v]));
  const [agents, skills, theses] = [pairs(ab).byB, pairs(sb).byB, pairs(tb).byB];
  return refs.map((r) => {
    const v = r.current_version_id ? vById.get(r.current_version_id) : undefined;
    const meta = (v?.metadata ?? {}) as Record<string, unknown>;
    return {
      id: r.id, type: r.type as ReferenceMaterialType, title: r.title, description: opt(r.description), legalAreaId: opt(r.legal_area_id),
      tags: r.tags ?? [], status: r.status as ReferenceMaterialStatus, version: v?.version_number ?? 0,
      hasText: !!v?.content_text,
      file: v?.storage_object_name ? {
        name: typeof meta.original_filename === "string" ? meta.original_filename : v.storage_object_name.split("/").pop() ?? "arquivo",
        mimeType: typeof meta.mime_type === "string" ? meta.mime_type : undefined,
        size: meta.file_size !== undefined ? Number(meta.file_size) : undefined,
      } : undefined,
      agentIds: agents.get(r.id) ?? [], skillIds: skills.get(r.id) ?? [], thesisIds: theses.get(r.id) ?? [], updatedAt: r.updated_at,
    };
  });
}

export async function prepareReferenceFile(ctx: ServiceContext, input: PrepareReferenceFileInput, storage: DgStorage = signedDgStorage()): Promise<PreparedReferenceFileDTO> {
  requireAdmin(ctx);
  const dot = input.fileName.lastIndexOf(".");
  const mimeType = dot < 0 ? undefined : REFERENCE_FILE_TYPES[input.fileName.slice(dot).toLowerCase()];
  if (!mimeType) throw invalido("Tipo de arquivo não aceito. Envie PDF, Word (.docx), texto ou Markdown.");
  const referenceId = input.referenceId ?? randomUUID();
  const versionId = randomUUID();
  const storageObjectName = referenceObjectName(referenceId, versionId, input.fileName);
  const { token } = await storage.createSignedUploadUrl(REFERENCE_BUCKET, storageObjectName);
  return { referenceId, versionId, file: { path: input.fileName, bucket: REFERENCE_BUCKET, storageObjectName, token, mimeType } };
}

export async function saveReference(ctx: ServiceContext, input: SaveReferenceInput): Promise<SaveResultDTO> {
  requireAdmin(ctx);
  if (input.file && input.versionId && !input.file.storageObjectName.startsWith(`references/${input.id}/${input.versionId}/`)) {
    throw invalido("Arquivo fora do caminho da versão.");
  }
  const payload: Record<string, unknown> = {
    id: input.id, create: input.create, version_id: input.versionId ?? null, type: input.type, title: input.title,
    description: input.description ?? "", legal_area_id: input.legalAreaId ?? null, tags: input.tags, status: input.status,
    ...(input.contentText ? { content_text: input.contentText } : {}),
    ...(input.file ? {
      storage_object_name: input.file.storageObjectName, original_filename: input.file.originalFilename,
      mime_type: input.file.mimeType, file_size: String(input.file.size),
    } : {}),
    ...(input.agentIds ? { agent_ids: input.agentIds } : {}),
    ...(input.skillIds ? { skill_ids: input.skillIds } : {}),
    ...(input.thesisIds ? { thesis_ids: input.thesisIds } : {}),
  };
  return toSaveResult(await repo.saveReference(ctx.db, input.key, payload), "reference_id");
}

/* ─── histórico de alterações (versões) ─────────────────────────────── */

export async function history(ctx: ServiceContext, input: HistoryInput): Promise<HistoryEntryDTO[]> {
  requireAdmin(ctx);
  const want = (t: HistoryEntryDTO["entityType"]) => !input.entityType || input.entityType === t;
  const n = input.limit;
  type V = { id: string; version_number: number; created_at: string; created_by: string | null };
  const [av, sv, tv, rv, agents, skills, theses, refs] = await Promise.all([
    want("AGENT") ? repo.recentVersions<V & { agent_id: string; instructions: string; configuration: unknown }>(ctx.db, "agent_versions", "id, agent_id, version_number, instructions, configuration, created_at, created_by", n) : [],
    want("SKILL") ? repo.recentVersions<V & { skill_id: string; instructions: string }>(ctx.db, "skill_versions", "id, skill_id, version_number, instructions, created_at, created_by", n) : [],
    want("THESIS") ? repo.recentVersions<repo.ThesisVersionRow>(ctx.db, "legal_thesis_versions", "id, legal_thesis_id, version_number, foundations, application_criteria, exclusion_criteria, notes, created_at, created_by", n) : [],
    want("REFERENCE") ? repo.recentVersions<V & { reference_material_id: string; content_text: string | null; storage_object_name: string | null }>(ctx.db, "reference_material_versions", "id, reference_material_id, version_number, content_text, storage_object_name, created_at, created_by", n) : [],
    repo.listAgents(ctx.db), repo.listSkills(ctx.db), repo.listTheses(ctx.db), repo.listReferences(ctx.db),
  ]);
  const name = {
    AGENT: new Map(agents.map((a) => [a.id, a.name])), SKILL: new Map(skills.map((s) => [s.id, s.name])),
    THESIS: new Map(theses.map((t) => [t.id, t.title])), REFERENCE: new Map(refs.map((r) => [r.id, r.title])),
  };
  const entries: (HistoryEntryDTO & { createdBy: string | null })[] = [];

  for (const v of av) {
    const prev = v.version_number > 1 ? await repo.previousVersion<{ instructions: string; configuration: unknown }>(ctx.db, "agent_versions", "instructions, configuration", "agent_id", v.agent_id, v.version_number) : null;
    entries.push({ id: v.id, entityType: "AGENT", entityId: v.agent_id, entityName: name.AGENT.get(v.agent_id) ?? "Agente", version: v.version_number, at: v.created_at, action: v.version_number === 1 ? "CREATED" : "UPDATED", createdBy: v.created_by, diff: lineDiff(prev ? agentVersionText(prev) : "", agentVersionText(v)) });
  }
  for (const v of sv) {
    const prev = v.version_number > 1 ? await repo.previousVersion<{ id: string; instructions: string }>(ctx.db, "skill_versions", "id, instructions", "skill_id", v.skill_id, v.version_number) : null;
    const files = await repo.skillFiles(ctx.db, [v.id, ...(prev ? [prev.id] : [])]);
    const of = (id: string) => files.filter((f) => f.skill_version_id === id).map((f) => ({ path: f.path, checksum_sha256: f.checksum_sha256 }));
    entries.push({ id: v.id, entityType: "SKILL", entityId: v.skill_id, entityName: name.SKILL.get(v.skill_id) ?? "Skill", version: v.version_number, at: v.created_at, action: v.version_number === 1 ? "CREATED" : "UPDATED", createdBy: v.created_by, diff: lineDiff(prev ? skillVersionText(prev, of(prev.id)) : "", skillVersionText(v, of(v.id))) });
  }
  for (const v of tv) {
    const prev = v.version_number > 1 ? await repo.previousVersion<repo.ThesisVersionRow>(ctx.db, "legal_thesis_versions", "foundations, application_criteria, exclusion_criteria, notes", "legal_thesis_id", v.legal_thesis_id, v.version_number) : null;
    entries.push({ id: v.id, entityType: "THESIS", entityId: v.legal_thesis_id, entityName: name.THESIS.get(v.legal_thesis_id) ?? "Tese", version: v.version_number, at: v.created_at, action: v.version_number === 1 ? "CREATED" : "UPDATED", createdBy: v.created_by, diff: lineDiff(prev ? thesisText(prev) : "", thesisText(v)) });
  }
  for (const v of rv) {
    const prev = v.version_number > 1 ? await repo.previousVersion<{ content_text: string | null; storage_object_name: string | null }>(ctx.db, "reference_material_versions", "content_text, storage_object_name", "reference_material_id", v.reference_material_id, v.version_number) : null;
    const txt = (x: { content_text: string | null; storage_object_name: string | null }) => x.content_text ?? `(arquivo ${x.storage_object_name?.split("/").pop() ?? ""})`;
    entries.push({ id: v.id, entityType: "REFERENCE", entityId: v.reference_material_id, entityName: name.REFERENCE.get(v.reference_material_id) ?? "Referência", version: v.version_number, at: v.created_at, action: v.version_number === 1 ? "CREATED" : "UPDATED", createdBy: v.created_by, diff: lineDiff(prev ? txt(prev) : "", txt(v)) });
  }

  entries.sort((a, b) => b.at.localeCompare(a.at));
  const page = entries.slice(0, n);
  const authors = await repo.profileNames(ctx.db, page.map((e) => e.createdBy ?? ""));
  return page.map(({ createdBy, ...e }) => ({ ...e, authorName: (createdBy && authors.get(createdBy)) || undefined }));
}

/* ─── interruptor e uso da IA ───────────────────────────────────────── */

function statusFrom(r: Record<string, unknown>): AiRuntimeStatusDTO {
  return {
    executionEnabled: r.execution_enabled === true,
    reason: typeof r.reason === "string" ? r.reason : undefined,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
    updatedByName: typeof r.updated_by_name === "string" ? r.updated_by_name : undefined,
  };
}

/** Situação do interruptor: qualquer usuário interno (a tela de análise mostra o aviso). */
export async function getAiStatus(ctx: ServiceContext): Promise<AiRuntimeStatusDTO> {
  requireInternal(ctx);
  return statusFrom(await repo.aiStatus(ctx.db));
}

export async function setAiEnabled(ctx: ServiceContext, enabled: boolean, reason?: string): Promise<AiRuntimeStatusDTO> {
  requireAdmin(ctx);
  const r = statusFrom(await repo.setAiEnabled(ctx.db, enabled, reason));
  ctx.log.info("dg.ai_execution_toggled", { enabled });
  return r;
}

export async function getAiUsage(ctx: ServiceContext, days: number): Promise<AiUsageDTO> {
  requireAdmin(ctx);
  const u = await repo.aiUsage(ctx.db, days) as {
    since: string; days: number; totals: Record<string, number | string>;
    by_agent: Record<string, unknown>[]; by_day: Record<string, unknown>[]; by_model: Record<string, unknown>[];
  };
  const row = (r: Record<string, unknown>, key: string, label: string): AiUsageRow => ({
    key, label, runs: Number(r.runs ?? 0), failed: r.failed !== undefined ? Number(r.failed) : undefined,
    inputTokens: Number(r.input_tokens ?? 0), outputTokens: Number(r.output_tokens ?? 0), estimatedCost: Number(r.estimated_cost ?? 0),
  });
  const t = u.totals;
  return {
    days: u.days, since: u.since,
    totals: {
      runs: Number(t.runs ?? 0), completed: Number(t.completed ?? 0), waitingHuman: Number(t.waiting_human ?? 0),
      failed: Number(t.failed ?? 0), cancelled: Number(t.cancelled ?? 0), active: Number(t.active ?? 0),
      inputTokens: Number(t.input_tokens ?? 0), outputTokens: Number(t.output_tokens ?? 0), estimatedCost: Number(t.estimated_cost ?? 0),
    },
    byAgent: u.by_agent.map((r) => row(r, String(r.agent_id), String(r.name))),
    byDay: u.by_day.map((r) => row(r, String(r.day), String(r.day))),
    byModel: u.by_model.map((r) => row(r, String(r.model), String(r.model))),
  };
}
