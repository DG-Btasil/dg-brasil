import { randomUUID } from "node:crypto";
import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { DbAnalysisStatus } from "@/repositories/api/db-mappings";
import * as agents from "../agents/service";
import type { AnalysisDetailDTO, AnalysisListItem, MissingRequirementDTO } from "./dto";
import { detailFromRow, fieldValuesPayload, listItemFromRow, missingRequirements, validateTemplateFields } from "./mappers";
import * as repo from "./repository";
import type { ListAnalysesInput, SendAnalysisToAgentInput, StartAnalysisInput } from "./schemas";

/**
 * Análise jurídica (básico): criar, consultar status, resultado estruturado
 * e documentos que faltam. Só ADMIN e LAWYER (`analyses.start`; a RLS de
 * legal_analyses é a mesma). Este service NUNCA chama modelo de IA: enviar ao
 * agente = pedir execução (request_agent_run) e ligar o id à análise.
 */

const NOT_FOUND_MESSAGE = "Análise não encontrada.";
/** De onde a análise pode ir para a fila (nova tentativa inclusa). */
const SENDABLE: DbAnalysisStatus[] = ["PENDING", "WAITING_DOCUMENTS", "FAILED", "CANCELLED"];

function requireAnalyst(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "analyses.start");
}

const one = <T>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

export async function listAnalyses(ctx: ServiceContext, input: ListAnalysesInput): Promise<Page<AnalysisListItem>> {
  requireAnalyst(ctx);
  const { rows, total } = await repo.list(ctx.db, { legalCaseId: input.legalCaseId, status: input.status }, input, { column: input.column, ascending: input.ascending });
  return toPage(rows.map(listItemFromRow), total, input);
}

/** Documentos do checklist do template que o caso ainda não tem. */
async function computeMissing(ctx: ServiceContext, legalCaseId: string, templateId: string): Promise<MissingRequirementDTO[]> {
  const [legalCase, template, satisfied] = await Promise.all([
    repo.getCase(ctx.db, legalCaseId),
    repo.getTemplate(ctx.db, templateId),
    repo.satisfiedCategories(ctx.db, legalCaseId),
  ]);
  const kind = one(legalCase?.clients)?.kind ?? "INDIVIDUAL";
  return missingRequirements(template?.analysis_template_requirements ?? [], kind, satisfied);
}

/** Análise com status do front, resultado estruturado e pendências de documento. */
export async function getAnalysis(ctx: ServiceContext, id: string): Promise<AnalysisDetailDTO> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  const [missing, reviewId] = await Promise.all([computeMissing(ctx, row.legal_case_id, row.analysis_template_id), repo.latestReviewId(ctx.db, id)]);
  return detailFromRow(row, missing, reviewId);
}

export async function getMissingRequirements(ctx: ServiceContext, id: string): Promise<MissingRequirementDTO[]> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  return computeMissing(ctx, row.legal_case_id, row.analysis_template_id);
}

/**
 * Cria a análise (PENDING) com as respostas do template. Template ativo e da
 * mesma área do caso; campos conferidos contra a definição do template.
 */
export async function startAnalysis(ctx: ServiceContext, input: StartAnalysisInput): Promise<{ id: string }> {
  requireAnalyst(ctx);
  const [legalCase, template] = await Promise.all([repo.getCase(ctx.db, input.legalCaseId), repo.getTemplate(ctx.db, input.templateId)]);
  if (!legalCase || legalCase.deleted_at) throw notFound("Caso não encontrado.");
  if (!template || !template.active) throw validation({ templateId: ["Template de análise indisponível."] });
  if (template.legal_area_id !== legalCase.legal_area_id) throw businessRule("O template não é da área jurídica deste caso.");
  const fieldErrors = validateTemplateFields(input.fields, template.analysis_template_fields ?? []);
  if (fieldErrors) throw validation(fieldErrors);

  const id = randomUUID();
  await repo.insert(ctx.db, {
    id,
    legal_case_id: input.legalCaseId,
    analysis_template_id: input.templateId,
    status: "PENDING",
    field_values: fieldValuesPayload(input.fields),
    started_by: ctx.session.userId,
  });
  ctx.log.info("analysis.created", { analysisId: id, legalCaseId: input.legalCaseId });
  return { id };
}

/**
 * Envia ao agente principal do template: exige os documentos obrigatórios,
 * pede a execução (request_agent_run_once com a chave do formulário: duplo
 * clique devolve a MESMA execução) e liga o id à análise (QUEUED). Duas
 * escritas; a chave torna a repetição segura — ver relatório da 4.2.
 */
export async function sendAnalysisToAgent(ctx: ServiceContext, input: SendAnalysisToAgentInput): Promise<{ agentRunId: string }> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, input.analysisId);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  if (!SENDABLE.includes(row.status)) throw invalidState("Esta análise já está com o agente ou foi concluída.");

  const [template, missing] = await Promise.all([repo.getTemplate(ctx.db, row.analysis_template_id), computeMissing(ctx, row.legal_case_id, row.analysis_template_id)]);
  if (missing.some((m) => m.required)) throw businessRule("Faltam documentos obrigatórios para enviar a análise ao agente.");
  if (!template?.primary_agent_id) throw businessRule("O template desta análise não tem agente configurado.");

  const run = await agents.requestAgentRun(ctx, {
    idempotencyKey: input.idempotencyKey,
    agentId: template.primary_agent_id,
    legalCaseId: row.legal_case_id,
    requestText: input.requestText,
    operation: "EXECUTE",
  });
  const changed = await repo.markQueued(ctx.db, row.id, run.runId, ctx.session.userId, SENDABLE);
  if (changed === 0) {
    // Duplo clique com a mesma chave: o outro clique já ligou ESTA execução — sucesso idempotente.
    const current = await repo.getById(ctx.db, row.id);
    if (current?.agent_run_id === run.runId) return { agentRunId: run.runId };
    ctx.log.warn("analysis.send_race", { analysisId: row.id, agentRunId: run.runId });
    throw invalidState("Esta análise já foi enviada ao agente.");
  }
  ctx.log.info("analysis.sent_to_agent", { analysisId: row.id, agentRunId: run.runId });
  return { agentRunId: run.runId };
}
