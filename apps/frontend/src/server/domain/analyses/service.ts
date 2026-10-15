import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, invalidState, notFound, validation } from "@/server/core/errors";
import * as agents from "@/server/domain/agents/service";
import type { AgentRunCancelDTO } from "@/server/domain/agents/dto";
import * as agentsRepo from "@/server/domain/agents/repository";
import { toPage, type Page } from "@/server/core/pagination";
import type { AnalysisDetailDTO, AnalysisListItem, AnalysisSetupDTO, AnalysisStartedDTO, MissingRequirementDTO } from "./dto";
import { detailFromRow, fieldValuesPayload, listItemFromRow, missingRequirements, templateSetupFromRow, validateTemplateFields } from "./mappers";
import * as repo from "./repository";
import type { ListAnalysesInput, SendAnalysisToAgentInput, StartAnalysisInput } from "./schemas";

/**
 * Análise jurídica (básico): criar, consultar status, resultado estruturado
 * e documentos que faltam. Só ADMIN e LAWYER (`analyses.start`; a RLS de
 * legal_analyses é a mesma). Este service NUNCA chama modelo de IA: enviar ao
 * agente = pedir a execução e ligar o id à análise, numa transação (029).
 */

const NOT_FOUND_MESSAGE = "Análise não encontrada.";

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
  const [missing, reviewId, cancel] = await Promise.all([
    computeMissing(ctx, row.legal_case_id, row.analysis_template_id),
    repo.latestReviewId(ctx.db, id),
    row.status === "RUNNING" && row.agent_run_id ? agentsRepo.cancelState(ctx.db, [row.agent_run_id]) : Promise.resolve(new Map<string, boolean>()),
  ]);
  return detailFromRow(row, missing, reviewId, row.agent_run_id ? cancel.get(row.agent_run_id) === true : false);
}

/**
 * "Interromper análise" (033): só com a execução na fila ou rodando. Na fila,
 * para na hora; rodando, vira pedido que o worker confirma (a análise muda
 * junto com a execução, pelo banco). Repetir é idempotente.
 */
export async function cancelAnalysis(ctx: ServiceContext, id: string): Promise<AgentRunCancelDTO> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  if (!row.agent_run_id || !(row.status === "QUEUED" || row.status === "RUNNING" || row.status === "CANCELLED")) {
    throw invalidState("Só se interrompe análise na fila ou em execução pelo agente.");
  }
  const result = await agents.cancelAgentRun(ctx, row.agent_run_id);
  ctx.log.info("analysis.cancel_requested", { analysisId: id, agentRunId: row.agent_run_id, outcome: result.outcome });
  return result;
}

export async function getMissingRequirements(ctx: ServiceContext, id: string): Promise<MissingRequirementDTO[]> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  return computeMissing(ctx, row.legal_case_id, row.analysis_template_id);
}

/**
 * Templates ATIVOS da área do caso, com os campos e o que falta de documento
 * para cada um (o assistente de nova análise). Sem agente → não pode enviar.
 */
export async function getAnalysisSetup(ctx: ServiceContext, legalCaseId: string): Promise<AnalysisSetupDTO> {
  requireAnalyst(ctx);
  const legalCase = await repo.getCase(ctx.db, legalCaseId);
  if (!legalCase || legalCase.deleted_at) throw notFound("Caso não encontrado.");
  const [templates, satisfied] = await Promise.all([repo.listTemplates(ctx.db, legalCase.legal_area_id), repo.satisfiedCategories(ctx.db, legalCaseId)]);
  const kind = one(legalCase.clients)?.kind ?? "INDIVIDUAL";
  return { templates: templates.map((t) => templateSetupFromRow(t, kind, satisfied)) };
}

/** Pré-condição de envio (leitura): documentos obrigatórios do template presentes. */
async function assertSendable(ctx: ServiceContext, legalCaseId: string, templateId: string) {
  const missing = await computeMissing(ctx, legalCaseId, templateId);
  if (missing.some((m) => m.required)) throw businessRule("Faltam documentos obrigatórios para enviar a análise ao agente.");
}

/**
 * Cria a análise com as respostas do template e, com `send`, já pede a
 * execução ao agente e liga — tudo numa transação idempotente no banco
 * (start_legal_analysis_once, 029). Template ativo e da mesma área do caso;
 * campos conferidos contra a definição do template. O banco reconfere papel,
 * caso, template e agente.
 */
export async function startAnalysis(ctx: ServiceContext, input: StartAnalysisInput): Promise<AnalysisStartedDTO> {
  requireAnalyst(ctx);
  const [legalCase, template] = await Promise.all([repo.getCase(ctx.db, input.legalCaseId), repo.getTemplate(ctx.db, input.templateId)]);
  if (!legalCase || legalCase.deleted_at) throw notFound("Caso não encontrado.");
  if (!template || !template.active) throw validation({ templateId: ["Template de análise indisponível."] });
  if (template.legal_area_id !== legalCase.legal_area_id) throw businessRule("O template não é da área jurídica deste caso.");
  const fieldErrors = validateTemplateFields(input.fields, template.analysis_template_fields ?? []);
  if (fieldErrors) throw validation(fieldErrors);
  if (input.send) {
    if (!template.primary_agent_id) throw businessRule("O template desta análise não tem agente configurado.");
    await assertSendable(ctx, input.legalCaseId, input.templateId);
  }

  const r = await repo.startOnce(ctx.db, {
    key: input.idempotencyKey,
    legalCaseId: input.legalCaseId,
    templateId: input.templateId,
    fields: fieldValuesPayload(input.fields),
    send: input.send,
    requestText: input.requestText ?? null,
    requestId: ctx.requestId,
  });
  ctx.log.info(r.deduplicated ? "analysis.start_replayed" : "analysis.created", {
    analysisId: r.analysis_id,
    legalCaseId: input.legalCaseId,
    agentRunId: r.agent_run_id ?? undefined,
    idempotencyKey: input.idempotencyKey,
  });
  return { id: r.analysis_id, agentRunId: r.agent_run_id ?? undefined, deduplicated: r.deduplicated };
}

/**
 * Envia (ou reenvia) ao agente principal do template: exige os documentos
 * obrigatórios e, numa transação no banco (send_legal_analysis_once, 029),
 * pede a execução, enfileira e liga a análise (QUEUED). Mesma chave devolve
 * a mesma execução; outra chave com a análise já na fila é recusada.
 */
export async function sendAnalysisToAgent(ctx: ServiceContext, input: SendAnalysisToAgentInput): Promise<{ agentRunId: string; deduplicated: boolean }> {
  requireAnalyst(ctx);
  const row = await repo.getById(ctx.db, input.analysisId);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  const template = await repo.getTemplate(ctx.db, row.analysis_template_id);
  if (!template?.primary_agent_id) throw businessRule("O template desta análise não tem agente configurado.");
  // O STATUS é decidido no banco (lock da linha): a repetição com a mesma chave
  // precisa chegar lá para devolver a mesma execução; outra chave é recusada.
  await assertSendable(ctx, row.legal_case_id, row.analysis_template_id);

  const r = await repo.sendOnce(ctx.db, input.idempotencyKey, row.id, input.requestText ?? null, ctx.requestId);
  ctx.log.info(r.deduplicated ? "analysis.send_replayed" : "analysis.sent_to_agent", { analysisId: row.id, agentRunId: r.agent_run_id ?? undefined });
  return { agentRunId: r.agent_run_id as string, deduplicated: r.deduplicated };
}
