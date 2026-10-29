import { createHash, randomBytes, randomUUID } from "node:crypto";
import { REFERENCE_FILE_TYPES } from "@/lib/constants/ai";
import type { AgentStatus, ReferenceMaterialStatus, ReferenceMaterialType, ThesisStatus } from "@/lib/constants/status";
import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { DomainError, notFound } from "@/server/core/errors";
import type {
  AgentDetailDTO, AgentListItemDTO, AiRuntimeStatusDTO, CreatedExecutorDTO, DgCatalogDTO, DgOverviewDTO, ExecutorDTO, HistoryEntryDTO,
  OfficeStatusDTO, PreparedReferenceFileDTO, ReferenceItemDTO, SaveResultDTO, ThesisDetailDTO, ThesisListItemDTO, VersionItemDTO,
} from "./dto";
import { agentStatusFromDb, agentStatusToDb, agentVersionText, configFromDb, configToDb, lineDiff, skillVersionText, slugify, thesisText } from "./mappers";
import * as repo from "./repository";
import type { HistoryInput, PrepareReferenceFileInput, SaveAgentInput, SaveReferenceInput, SaveThesisInput } from "./schemas";
import { REFERENCE_BUCKET, referenceObjectName, signedDgStorage, type DgStorage } from "./storage";

/**
 * Área DG Brasil (só ADMIN): agentes, teses, referências, histórico de
 * versões, o interruptor e o computador do escritório. Tudo real, do banco.
 * Nenhuma função aqui chama IA: quem executa é o Claude Code do escritório
 * (040). Instruções e skills dos agentes moram no Claude Code; aqui fica a
 * ligação "qual agente local faz qual trabalho" e as orientações do DG Brasil.
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
  const [agents, theses, ...counts] = await Promise.all([
    repo.listAgents(ctx.db), repo.listTheses(ctx.db),
    repo.countSince(ctx.db, "agent_versions", since30),
    repo.countSince(ctx.db, "legal_thesis_versions", since30), repo.countSince(ctx.db, "reference_material_versions", since30),
    repo.countSince(ctx.db, "agent_runs", month.toISOString()),
  ]);
  return {
    activeAgents: agents.filter((a) => a.status === "ACTIVE").length,
    totalAgents: agents.length,
    activeTheses: theses.filter((t) => t.status === "ACTIVE").length,
    changesLast30Days: counts.slice(0, 3).reduce((a, b) => a + b, 0),
    monthRuns: counts[3] ?? 0,
  };
}

export async function catalog(ctx: ServiceContext): Promise<DgCatalogDTO> {
  requireAdmin(ctx);
  const [agents, theses, references, areas, templates] = await Promise.all([
    repo.listAgents(ctx.db), repo.listTheses(ctx.db), repo.listReferences(ctx.db),
    repo.legalAreas(ctx.db), repo.templates(ctx.db),
  ]);
  return {
    agents: agents.map((a) => ({ id: a.id, name: a.name })),
    theses: theses.map((t) => ({ id: t.id, name: t.title })),
    references: references.map((r) => ({ id: r.id, name: r.title })),
    legalAreas: areas,
    templates: templates.map((t) => ({ id: t.id, name: t.name, legalAreaName: one(t.legal_areas)?.name ?? "", active: t.active, agentId: opt(t.primary_agent_id) })),
  };
}

/* ─── agentes ────────────────────────────────────────────────────────── */

export async function listAgents(ctx: ServiceContext): Promise<AgentListItemDTO[]> {
  requireAdmin(ctx);
  const [agents, thesisB, runs] = await Promise.all([
    repo.listAgents(ctx.db), repo.bindings(ctx.db, "agent_thesis_bindings"), repo.recentRuns(ctx.db, daysAgo(7)),
  ]);
  const [vers, last] = await Promise.all([
    repo.agentVersionsByIds(ctx.db, agents.map((a) => a.current_version_id).filter((v): v is string => !!v)),
    repo.lastRunPerAgent(ctx.db, agents.map((a) => a.id)),
  ]);
  const vById = new Map(vers.map((v) => [v.id, v]));
  const theses = pairs(thesisB).byA;
  return agents.map((a) => {
    const v = a.current_version_id ? vById.get(a.current_version_id) : undefined;
    const cfg = configFromDb(v?.configuration);
    return {
      id: a.id, slug: a.slug, name: a.name, description: opt(a.description), purpose: opt(a.purpose),
      status: agentStatusFromDb(a.status), version: v?.version_number ?? 0, localAgent: cfg.localAgent || undefined,
      thesisCount: theses.get(a.id)?.length ?? 0,
      lastRunAt: last.get(a.id), runsLast7Days: runs.filter((r) => r.agent_id === a.id).length, updatedAt: a.updated_at,
    };
  });
}

export async function getAgent(ctx: ServiceContext, id: string): Promise<AgentDetailDTO> {
  requireAdmin(ctx);
  const a = await repo.getAgent(ctx.db, id);
  if (!a) throw notFound("Agente não encontrado.");
  const [allVersions, current, thesisB, refB, tpl, last, runs] = await Promise.all([
    repo.agentVersions(ctx.db, id),
    a.current_version_id ? repo.agentVersionsByIds(ctx.db, [a.current_version_id], true) : Promise.resolve([]),
    repo.bindings(ctx.db, "agent_thesis_bindings"), repo.bindings(ctx.db, "agent_reference_bindings"),
    repo.templates(ctx.db), repo.lastRunPerAgent(ctx.db, [id]), repo.recentRuns(ctx.db, daysAgo(7)),
  ]);
  const v = current[0];
  const names = await repo.profileNames(ctx.db, allVersions.map((x) => x.created_by ?? ""));
  const cfg = configFromDb(v?.configuration);
  const thesisIds = pairs(thesisB).byA.get(id) ?? [];
  return {
    id: a.id, slug: a.slug, name: a.name, description: opt(a.description), purpose: opt(a.purpose),
    status: agentStatusFromDb(a.status), version: v?.version_number ?? 0, localAgent: cfg.localAgent || undefined,
    thesisCount: thesisIds.length, lastRunAt: last.get(id),
    runsLast7Days: runs.filter((r) => r.agent_id === id).length, updatedAt: a.updated_at,
    versionId: v?.id, instructions: v?.instructions ?? "", config: cfg, versions: versions(allVersions, names),
    thesisIds, referenceIds: pairs(refB).byA.get(id) ?? [],
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
  const [all, ab, rb] = await Promise.all([
    repo.thesisVersions(ctx.db, id), repo.bindings(ctx.db, "agent_thesis_bindings"), repo.bindings(ctx.db, "thesis_reference_bindings"),
  ]);
  const cur = all.find((v) => v.id === t.current_version_id);
  const names = await repo.profileNames(ctx.db, all.map((v) => v.created_by ?? ""));
  return {
    ...thesisItem(t, cur?.version_number ?? 0, pairs(ab).byB.get(id) ?? []),
    foundations: opt(cur?.foundations), applicationCriteria: opt(cur?.application_criteria),
    exclusionCriteria: opt(cur?.exclusion_criteria), notes: opt(cur?.notes),
    versions: versions(all, names), referenceIds: pairs(rb).byA.get(id) ?? [],
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
    ...(input.referenceIds ? { reference_ids: input.referenceIds } : {}),
  };
  return toSaveResult(await repo.saveThesis(ctx.db, input.key, payload), "thesis_id");
}

/* ─── referências ────────────────────────────────────────────────────── */

export async function listReferences(ctx: ServiceContext): Promise<ReferenceItemDTO[]> {
  requireAdmin(ctx);
  const [refs, ab, tb] = await Promise.all([
    repo.listReferences(ctx.db), repo.bindings(ctx.db, "agent_reference_bindings"), repo.bindings(ctx.db, "thesis_reference_bindings"),
  ]);
  const vers = await repo.referenceVersionsByIds(ctx.db, refs.map((r) => r.current_version_id).filter((v): v is string => !!v));
  const vById = new Map(vers.map((v) => [v.id, v]));
  const [agents, theses] = [pairs(ab).byB, pairs(tb).byB];
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
      agentIds: agents.get(r.id) ?? [], thesisIds: theses.get(r.id) ?? [], updatedAt: r.updated_at,
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

/* ─── interruptor e computador do escritório ───────────────────────── */

function statusFrom(r: Record<string, unknown>): AiRuntimeStatusDTO {
  return {
    executionEnabled: r.execution_enabled === true,
    reason: typeof r.reason === "string" ? r.reason : undefined,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : undefined,
    updatedByName: typeof r.updated_by_name === "string" ? r.updated_by_name : undefined,
  };
}

/** Situação do interruptor: qualquer usuário interno. */
export async function getAiStatus(ctx: ServiceContext): Promise<AiRuntimeStatusDTO> {
  requireInternal(ctx);
  return statusFrom(await repo.aiStatus(ctx.db));
}

/** Liga/desliga a execução pelo escritório (ai_runtime_settings): desligado, nada novo é reservado. */
export async function setAiEnabled(ctx: ServiceContext, enabled: boolean, reason?: string): Promise<AiRuntimeStatusDTO> {
  requireAdmin(ctx);
  const r = statusFrom(await repo.setAiEnabled(ctx.db, enabled, reason));
  ctx.log.info("dg.office_execution_toggled", { enabled });
  return r;
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Computador conectado e fila: qualquer usuário interno (a análise avisa). Lista de computadores: só ADMIN (o banco decide). */
export async function getOfficeStatus(ctx: ServiceContext): Promise<OfficeStatusDTO> {
  requireInternal(ctx);
  const r = await repo.executorStatus(ctx.db);
  const list = Array.isArray(r.executors) ? (r.executors as Record<string, unknown>[]) : undefined;
  return {
    executionEnabled: r.execution_enabled === true,
    online: r.online === true,
    lastSeenAt: str(r.last_seen_at),
    queued: Number(r.queued ?? 0),
    running: Number(r.running ?? 0),
    executors: list?.map((e): ExecutorDTO => ({
      id: String(e.id), name: String(e.name), tokenPrefix: String(e.token_prefix), online: e.online === true,
      lastSeenAt: str(e.last_seen_at), clientVersion: str(e.client_version), revokedAt: str(e.revoked_at),
      createdAt: String(e.created_at), createdByName: str(e.created_by_name), running: Number(e.running ?? 0),
    })),
  };
}

/**
 * Autoriza um computador. O token nasce AQUI (32 bytes aleatórios), vai ao
 * banco só como SHA-256 e volta UMA vez para a tela. Perdeu: revogue e crie outro.
 */
export async function createExecutor(ctx: ServiceContext, name: string): Promise<CreatedExecutorDTO> {
  requireAdmin(ctx);
  const token = `dgx_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");
  const r = await repo.createExecutor(ctx.db, name, hash, token.slice(0, 10));
  ctx.log.info("dg.executor_created", { executorId: String(r.id) });
  return { id: String(r.id), name, token };
}

export async function revokeExecutor(ctx: ServiceContext, id: string): Promise<{ released: number }> {
  requireAdmin(ctx);
  const r = await repo.revokeExecutor(ctx.db, id);
  ctx.log.info("dg.executor_revoked", { executorId: id, released: Number(r.released ?? 0) });
  return { released: Number(r.released ?? 0) };
}
