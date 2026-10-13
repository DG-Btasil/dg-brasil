import { isPartner, requireAnyPermission, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { invalidState, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import * as documentsRepo from "../repository";
import type { RequirementDTO, RequirementInternalDTO } from "./dto";
import { canTransition, internalRequirementFromRow, partnerRequirementFromRow, REQUIREMENT_TRANSITIONS, type RequirementTransition } from "./mappers";
import * as repo from "./repository";
import type { CreateRequirementInput, ListRequirementsInput, SatisfyRequirementInput } from "./schemas";

/**
 * Pendências de documento do caso. Não confundir com documento: a pendência
 * diz o que falta; é atendida por uma VERSÃO concreta de documento.
 *
 *   MISSING ─request→ REQUESTED ─satisfy→ RECEIVED ─approve→ APPROVED
 *                                            └─reject→ REJECTED ─request/satisfy→ …
 *
 * Escrita: só equipe interna (RLS). Criar, pedir e atender: documents.manage.
 * Aprovar/rejeitar é decisão jurídica: reviews.decide (ADMIN, LAWYER).
 * A regra "versão do mesmo cliente e vinculada ao caso" é do BANCO (trigger
 * da 007) — não é reimplementada aqui; a mensagem dele chega ao usuário.
 */

const REQ_NOT_FOUND = "Pendência não encontrada.";

function requireWrite(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "documents.manage");
}

function requireDecide(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "reviews.decide");
}

export async function listRequirements(ctx: ServiceContext, input: ListRequirementsInput): Promise<Page<RequirementDTO>> {
  requireAnyPermission(ctx, "documents.manage", "cases.view", "partnerPortal.view");
  // Caso inacessível = "não encontrado" (não uma lista vazia que confirma o id).
  if (!(await documentsRepo.getCaseRef(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");
  const { rows, total } = await repo.listByCase(ctx.db, input.legalCaseId, { status: input.status }, input);
  const partner = isPartner(ctx);
  return toPage(
    rows.map((r) => (partner ? { surface: "PARTNER" as const, ...partnerRequirementFromRow(r) } : { surface: "INTERNAL" as const, ...internalRequirementFromRow(r) })),
    total,
    input,
  );
}

export async function createRequirement(ctx: ServiceContext, input: CreateRequirementInput): Promise<RequirementInternalDTO> {
  requireWrite(ctx);
  if (!(await documentsRepo.getCaseRef(ctx.db, input.legalCaseId))) throw notFound("Caso não encontrado.");
  const row = await repo.insert(ctx.db, {
    legal_case_id: input.legalCaseId,
    requirement_label: input.label,
    category: input.category,
    required: input.required,
    status: input.requestNow ? "REQUESTED" : "MISSING",
  });
  ctx.log.info("requirement.created", { requirementId: row.id, legalCaseId: row.legal_case_id });
  return internalRequirementFromRow(row);
}

/** Aplica a transição só se o status atual permitir (concorrência otimista). */
async function applyTransition(ctx: ServiceContext, id: string, transition: RequirementTransition, patch: Record<string, unknown>): Promise<RequirementInternalDTO> {
  const rule = REQUIREMENT_TRANSITIONS[transition];
  const updated = await repo.transition(ctx.db, id, rule.from, { ...patch, status: rule.to });
  if (!updated) {
    const current = await repo.getById(ctx.db, id);
    if (!current) throw notFound(REQ_NOT_FOUND);
    throw invalidState("A situação atual da pendência não permite esta operação.");
  }
  ctx.log.info("requirement.status_changed", { requirementId: id, legalCaseId: updated.legal_case_id, transition, status: updated.status });
  return internalRequirementFromRow(updated);
}

/** Pedir o documento (ou pedir de novo depois de rejeitado): limpa a versão anterior. */
export async function requestRequirement(ctx: ServiceContext, id: string): Promise<RequirementInternalDTO> {
  requireWrite(ctx);
  return applyTransition(ctx, id, "REQUEST", { requested_at: new Date().toISOString(), satisfied_by_document_version_id: null, satisfied_at: null });
}

/**
 * Recebido: atende a pendência com uma versão concreta. O banco recusa versão
 * de outro cliente ou de documento não vinculado ao caso.
 */
export async function satisfyRequirement(ctx: ServiceContext, input: SatisfyRequirementInput): Promise<RequirementInternalDTO> {
  requireWrite(ctx);
  const current = await repo.getById(ctx.db, input.id);
  if (!current) throw notFound(REQ_NOT_FOUND);
  if (!canTransition(current.status, "SATISFY")) throw invalidState("A situação atual da pendência não permite esta operação.");
  if (!(await documentsRepo.getVersion(ctx.db, input.documentVersionId))) throw notFound("Versão não encontrada.");
  return applyTransition(ctx, input.id, "SATISFY", {
    satisfied_by_document_version_id: input.documentVersionId,
    satisfied_at: new Date().toISOString(),
  });
}

export async function approveRequirement(ctx: ServiceContext, id: string): Promise<RequirementInternalDTO> {
  requireDecide(ctx);
  return applyTransition(ctx, id, "APPROVE", {});
}

/** Rejeitar mantém a versão recusada registrada (a trilha de auditoria também guarda). */
export async function rejectRequirement(ctx: ServiceContext, id: string): Promise<RequirementInternalDTO> {
  requireDecide(ctx);
  return applyTransition(ctx, id, "REJECT", {});
}
