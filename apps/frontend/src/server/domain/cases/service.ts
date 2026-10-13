import { randomUUID } from "node:crypto";
import { explicitPartnerLink } from "@/lib/domain/legal-case";
import {
  isPartner,
  requireAnyPermission,
  requireInternal,
  requirePermission,
  requireRole,
  type ServiceContext,
} from "@/server/core/context";
import { DomainError, forbidden, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type {
  CaseAcceptedDTO,
  CaseCreatedDTO,
  CaseDetailDTO,
  CaseListItem,
  CaseOriginChangedDTO,
  CaseRejectedDTO,
  PartnerCaseSubmittedDTO,
} from "./dto";
import { createPayload, internalCaseFromRows, listItemFromRow, partnerCaseFromRow, partnerSubmitPayload, updatePayload } from "./mappers";
import * as repo from "./repository";
import type {
  AcceptCaseInput,
  AssignLawyerInput,
  ChangeOriginInput,
  CreateCaseInput,
  ListCasesInput,
  OverrideStatusInput,
  PartnerOrigin,
  PartnerSubmitCaseInput,
  RejectCaseInput,
  UpdateCaseInput,
} from "./schemas";

/**
 * Regras do Caso Jurídico. Autorização contextual aqui; RLS, triggers e
 * funções do banco como segunda barreira — e as invariantes de dado continuam
 * NO BANCO, não reimplementadas aqui:
 *   - máquina de estados (private.case_status_transition_allowed);
 *   - aceite exige advogado ADMIN/LAWYER ativo; rejeição exige motivo público;
 *   - datas de cada estado, `accepted_by` e snapshot de parceria (triggers);
 *   - origem permitida e troca de origem após aceite (change_case_origin).
 * O service só pede a mudança e traduz a recusa do banco.
 *
 * Organização no caso: `partner_organization_id` é o ÚNICO acesso do
 * parceiro; `origin_organization_id` é atribuição comercial e nunca concede
 * acesso (vínculo só por opt-in explícito `linkPartner`).
 */

/* ------------------------------------------------------------------ */
/* Apoio                                                               */
/* ------------------------------------------------------------------ */

/** Leitura: equipe interna (cases.view) ou Portal do Parceiro. */
function requireCaseRead(ctx: ServiceContext) {
  requireAnyPermission(ctx, "cases.view", "partnerPortal.view");
}

/** Edição de cadastro / envio: equipe interna (cases.edit) ou parceiro (envio de caso). */
function requireCaseWrite(ctx: ServiceContext) {
  if (isPartner(ctx)) requirePermission(ctx, "partnerPortal.cases.create");
  else requirePermission(ctx, "cases.edit");
}

/** Decisões (aceitar, rejeitar, encerrar, arquivar): ADMIN e LAWYER. */
function requireDecision(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "cases.decide");
}

/**
 * O UPDATE não alcançou nenhuma linha: explica sem revelar o que não se
 * acessa. Não visível → NOT_FOUND. Visível mas fora do alcance da RLS de
 * UPDATE → parceiro: só rascunho é editável; interno (ASSISTANT após o
 * aceite): sem permissão.
 */
async function explainUntouched(ctx: ServiceContext, id: string): Promise<never> {
  const state = await repo.getCaseState(ctx.db, id);
  if (!state) throw notFound("Caso não encontrado.");
  if (isPartner(ctx)) throw invalidState("Só é possível alterar casos em rascunho.");
  throw forbidden();
}

/** Muda o status; quem decide se a transição vale é o banco. */
async function transition(ctx: ServiceContext, id: string, status: string, event: string): Promise<void> {
  const count = await repo.updateCase(ctx.db, id, { status });
  if (count === 0) await explainUntouched(ctx, id);
  ctx.log.info(event, { legalCaseId: id });
}

/** Área/tipo por código → ids do catálogo. Ids informados seguem direto (FK confere). */
async function resolveCatalog(
  ctx: ServiceContext,
  input: { area?: string; legalAreaId?: string; caseTypeCode?: string | null; caseTypeId?: string | null },
  currentAreaId?: string,
): Promise<{ legalAreaId?: string; caseTypeId?: string | null }> {
  let legalAreaId = input.legalAreaId;
  if (input.area !== undefined) {
    const found = await repo.findAreaIdByCode(ctx.db, input.area);
    if (!found) throw validation({ area: ["Área jurídica não encontrada."] });
    legalAreaId = found;
  }
  const areaForType = legalAreaId ?? currentAreaId;
  let caseTypeId: string | null | undefined = input.caseTypeId;
  if (input.caseTypeCode === null) caseTypeId = null;
  else if (input.caseTypeCode !== undefined) {
    const found = areaForType ? await repo.findCaseTypeIdByCode(ctx.db, areaForType, input.caseTypeCode) : null;
    if (!found) throw validation({ caseTypeCode: ["Tipo de caso não encontrado para esta área."] });
    caseTypeId = found;
  }
  return { legalAreaId, caseTypeId };
}

/* ------------------------------------------------------------------ */
/* Leitura                                                             */
/* ------------------------------------------------------------------ */

export async function listCases(ctx: ServiceContext, input: ListCasesInput): Promise<Page<CaseListItem>> {
  requireCaseRead(ctx);
  const partner = isPartner(ctx);
  const { rows, total } = await repo.listCases(
    ctx.db,
    partner ? "PARTNER" : "INTERNAL",
    {
      q: input.q,
      status: input.status,
      clientId: input.clientId,
      // Parceiro não filtra por advogado nem por escritório: a RLS já limita aos próprios casos.
      assignedLawyerId: partner ? undefined : input.assignedLawyerId,
      partnerOrganizationId: partner ? undefined : input.partnerOrganizationId,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  return toPage(
    rows.map((r) => listItemFromRow(r, ctx.session)),
    total,
    input,
  );
}

/** Ficha do caso. Parceiro: só colunas compartilhadas; dados internos nem são consultados. */
export async function getCase(ctx: ServiceContext, id: string): Promise<CaseDetailDTO> {
  requireCaseRead(ctx);
  if (isPartner(ctx)) {
    const row = await repo.getCase(ctx.db, id, "PARTNER");
    if (!row) throw notFound("Caso não encontrado.");
    return { surface: "PARTNER", legalCase: partnerCaseFromRow(row, ctx.session.organizationId) };
  }
  const row = await repo.getCase(ctx.db, id, "INTERNAL");
  if (!row) throw notFound("Caso não encontrado.");
  const internal = await repo.getInternalDetails(ctx.db, id);
  return { surface: "INTERNAL", legalCase: internalCaseFromRows(row, internal, ctx.session.organizationId) };
}

/* ------------------------------------------------------------------ */
/* Cadastro                                                            */
/* ------------------------------------------------------------------ */

/**
 * Cadastro interno: rascunho ou já enviado. A origem nunca concede acesso:
 * o parceiro só é vinculado com `linkPartner` (e se a origem for parceiro).
 */
export async function createCase(ctx: ServiceContext, input: CreateCaseInput): Promise<CaseCreatedDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "cases.edit");
  const catalog = await resolveCatalog(ctx, input);
  if (!catalog.legalAreaId) throw validation({ area: ["Informe a área jurídica."] });
  const id = randomUUID();
  // Usuário interno pertence ao escritório proprietário: a sessão é a fonte.
  const partnerOrganizationId = explicitPartnerLink(input.originOrganizationId, ctx.session.organizationId, input.linkPartner);
  await repo.insertCase(
    ctx.db,
    createPayload(input, { id, legalAreaId: catalog.legalAreaId, caseTypeId: catalog.caseTypeId ?? null, partnerOrganizationId }),
  );
  if (input.notes) await repo.upsertInternalDetails(ctx.db, id, { internal_notes: input.notes });
  ctx.log.info("case.created", { legalCaseId: id, clientId: input.clientId, partnerLinked: partnerOrganizationId !== null });
  return { id };
}

/**
 * Portal do Parceiro: cliente (canônico por CPF/CNPJ) + caso SUBMITTED do
 * próprio escritório numa transação (partner_submit_case). As origens são
 * escolhas entre "meu escritório" e "proprietário": os ids vêm da sessão e
 * do banco, nunca do navegador.
 */
export async function partnerSubmitCase(ctx: ServiceContext, input: PartnerSubmitCaseInput): Promise<PartnerCaseSubmittedDTO> {
  if (!isPartner(ctx)) throw forbidden();
  requirePermission(ctx, "partnerPortal.cases.create");
  const own = ctx.session.organizationId;
  const needsOwner = input.client.origin === "OWNER" || input.case.origin === "OWNER";
  const owner = needsOwner ? await repo.ownerOrganizationId(ctx.db) : undefined;
  const originId = (origin: PartnerOrigin) => (origin === "OWNER" ? (owner as string) : own);

  const catalog = await resolveCatalog(ctx, input.case);
  if (!catalog.legalAreaId) throw validation({ area: ["Informe a área jurídica."] });

  const result = await repo.partnerSubmit(
    ctx.db,
    partnerSubmitPayload(input, {
      clientOriginId: originId(input.client.origin),
      caseOriginId: originId(input.case.origin),
      legalAreaId: catalog.legalAreaId,
      caseTypeId: catalog.caseTypeId ?? null,
    }),
  );
  ctx.log.info("case.partner_submitted", { legalCaseId: result.legal_case_id, clientId: result.client_id, clientExisted: result.client_existed });
  return { clientId: result.client_id, legalCaseId: result.legal_case_id, clientExisted: result.client_existed };
}

/**
 * Edição (PATCH). Interno: cadastro + observações internas. Parceiro: só os
 * campos compartilhados, e só em rascunho (RLS).
 */
export async function updateCase(ctx: ServiceContext, input: UpdateCaseInput): Promise<void> {
  requireCaseWrite(ctx);
  const { patch } = input;
  const partner = isPartner(ctx);
  if (partner && patch.notes !== undefined) throw forbidden();

  const touchesCatalog = ["area", "legalAreaId", "caseTypeCode", "caseTypeId"].some((k) => k in patch);
  let catalog: { legalAreaId?: string; caseTypeId?: string | null } | undefined;
  if (touchesCatalog) {
    const changesArea = patch.area !== undefined || patch.legalAreaId !== undefined;
    const changesType = "caseTypeCode" in patch || "caseTypeId" in patch;
    // Trocar só o tipo por código: o código é resolvido na área atual do caso.
    const current = !changesArea && patch.caseTypeCode ? await repo.getCaseState(ctx.db, input.id) : null;
    if (!changesArea && patch.caseTypeCode && !current) throw notFound("Caso não encontrado.");
    catalog = await resolveCatalog(ctx, patch, current?.legal_area_id);
    // O tipo pertence à área: trocar a área sem informar o tipo remove o tipo antigo.
    if (changesArea && !changesType) catalog.caseTypeId = null;
  }

  const columns = updatePayload(patch, catalog);
  if (Object.keys(columns).length > 0) {
    const count = await repo.updateCase(ctx.db, input.id, columns);
    if (count === 0) await explainUntouched(ctx, input.id);
  } else if (!(await repo.getCaseState(ctx.db, input.id))) {
    throw notFound("Caso não encontrado.");
  }

  if (!partner && patch.notes !== undefined) {
    await repo.upsertInternalDetails(ctx.db, input.id, { internal_notes: patch.notes ?? null });
  }
  ctx.log.info("case.updated", { legalCaseId: input.id });
}

/* ------------------------------------------------------------------ */
/* Transições                                                          */
/* ------------------------------------------------------------------ */

/** Rascunho (ou aguardando documentos) → Enviado. Interno ou parceiro (rascunho do próprio escritório). */
export async function submitCase(ctx: ServiceContext, id: string): Promise<void> {
  requireCaseWrite(ctx);
  await transition(ctx, id, "SUBMITTED", "case.submitted");
}

/** Pede documentos ao cliente/parceiro: → WAITING_DOCUMENTS. */
export async function requestCaseDocuments(ctx: ServiceContext, id: string): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "cases.edit");
  await transition(ctx, id, "WAITING_DOCUMENTS", "case.documents_requested");
}

/**
 * Aceite: status ACCEPTED + advogado num ÚNICO update. O banco exige o
 * advogado (ADMIN/LAWYER ativo), preenche accepted_at, grava accepted_by e
 * cria o snapshot de parceria se a origem for parceiro.
 *
 * Idempotente: o update não toca caso já ACCEPTED (segundo clique = nada
 * muda, nenhum snapshot novo). Na corrida, a unique parcial do snapshot
 * (um ativo por caso) é a última barreira; o conflito vira "já aceito".
 */
export async function acceptCase(ctx: ServiceContext, input: AcceptCaseInput): Promise<CaseAcceptedDTO> {
  requireDecision(ctx);
  const payload: Record<string, unknown> = { status: "ACCEPTED" };
  if (input.lawyerId) payload.assigned_lawyer_id = input.lawyerId;

  let count: number;
  try {
    count = await repo.updateCase(ctx.db, input.id, payload, { exceptStatus: "ACCEPTED" });
  } catch (error) {
    if (error instanceof DomainError && error.code === "CONFLICT") {
      const state = await repo.getCaseState(ctx.db, input.id);
      if (state?.status === "ACCEPTED") {
        ctx.log.warn("case.accept_conflict_resolved", { legalCaseId: input.id });
        return { alreadyAccepted: true };
      }
    }
    throw error;
  }
  if (count === 0) {
    const state = await repo.getCaseState(ctx.db, input.id);
    if (!state) throw notFound("Caso não encontrado.");
    if (state.status === "ACCEPTED") return { alreadyAccepted: true };
    throw forbidden();
  }
  ctx.log.info("case.accepted", { legalCaseId: input.id, lawyerId: input.lawyerId });
  return { alreadyAccepted: false };
}

/**
 * Rejeição: motivo público (o parceiro vê) obrigatório; motivo interno em
 * legal_case_internal_details (o parceiro nunca vê). Ordem: primeiro a linha
 * interna, depois o status — o caso nunca fica REJEITADO sem o registro
 * interno. Se o status falhar, o motivo interno anterior é restaurado.
 */
export async function rejectCase(ctx: ServiceContext, input: RejectCaseInput): Promise<CaseRejectedDTO> {
  requireDecision(ctx);
  const state = await repo.getCaseState(ctx.db, input.id);
  if (!state) throw notFound("Caso não encontrado.");
  if (state.status === "REJECTED") return { alreadyRejected: true };

  const previous = (await repo.getInternalDetails(ctx.db, input.id))?.rejection_reason_internal ?? null;
  // Sempre grava (inclusive null): rejeição nova não herda nota de uma rejeição reconsiderada.
  await repo.upsertInternalDetails(ctx.db, input.id, { rejection_reason_internal: input.internalNote ?? null });

  const restore = async () => {
    await repo.upsertInternalDetails(ctx.db, input.id, { rejection_reason_internal: previous }).catch((e: unknown) => {
      ctx.log.error("case.reject_restore_failed", { legalCaseId: input.id, technicalCode: e instanceof DomainError ? e.technicalCode : undefined });
    });
  };

  let count: number;
  try {
    count = await repo.updateCase(ctx.db, input.id, { status: "REJECTED", rejection_reason_public: input.publicReason }, { exceptStatus: "REJECTED" });
  } catch (error) {
    await restore();
    throw error;
  }
  if (count === 0) {
    // Outra requisição rejeitou no meio do caminho: vale a rejeição dela.
    await restore();
    const now = await repo.getCaseState(ctx.db, input.id);
    if (now?.status === "REJECTED") return { alreadyRejected: true };
    if (!now) throw notFound("Caso não encontrado.");
    throw forbidden();
  }
  ctx.log.info("case.rejected", { legalCaseId: input.id });
  return { alreadyRejected: false };
}

/** Aceito → Em andamento. */
export async function startCase(ctx: ServiceContext, id: string): Promise<void> {
  requireDecision(ctx);
  await transition(ctx, id, "IN_PROGRESS", "case.started");
}

/** Aceito/Em andamento → Encerrado. */
export async function closeCase(ctx: ServiceContext, id: string): Promise<void> {
  requireDecision(ctx);
  await transition(ctx, id, "CLOSED", "case.closed");
}

/** → Arquivado (terminal). O banco decide de quais estados. */
export async function archiveCase(ctx: ServiceContext, id: string): Promise<void> {
  requireDecision(ctx);
  await transition(ctx, id, "ARCHIVED", "case.archived");
}

/* ------------------------------------------------------------------ */
/* Advogado, origem e exceções                                         */
/* ------------------------------------------------------------------ */

/** Atribui o advogado responsável (o banco exige ADMIN/LAWYER interno ativo). */
export async function assignCaseLawyer(ctx: ServiceContext, input: AssignLawyerInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "cases.edit");
  const count = await repo.updateCase(ctx.db, input.id, { assigned_lawyer_id: input.lawyerId });
  if (count === 0) await explainUntouched(ctx, input.id);
  ctx.log.info("case.lawyer_assigned", { legalCaseId: input.id, lawyerId: input.lawyerId });
}

/**
 * Troca a origem comercial por change_case_origin (antes do aceite: equipe
 * interna; depois: só ADMIN, com motivo — o banco decide e audita; o snapshot
 * de parceria é cancelado/recriado na mesma transação).
 *
 * A troca NUNCA mexe no acesso do parceiro. Exceção: `linkPartner` (opt-in
 * interno) vincula o parceiro de origem a um caso que ainda não tem parceiro.
 */
export async function changeCaseOrigin(ctx: ServiceContext, input: ChangeOriginInput): Promise<CaseOriginChangedDTO> {
  requireInternal(ctx);
  requireAnyPermission(ctx, "cases.edit", "cases.origin.override");
  const link = explicitPartnerLink(input.originOrganizationId, ctx.session.organizationId, input.linkPartner);

  let currentPartner: string | null = null;
  if (link) {
    const state = await repo.getCaseState(ctx.db, input.id);
    if (!state) throw notFound("Caso não encontrado.");
    currentPartner = state.partner_organization_id;
    if (currentPartner && currentPartner !== link) throw invalidState("O caso já está vinculado a outro escritório parceiro.");
  }

  await repo.changeOrigin(ctx.db, input.id, input.originOrganizationId, input.reason ?? null);

  let partnerLinked = false;
  if (link && currentPartner === null) {
    const count = await repo.updateCase(ctx.db, input.id, { partner_organization_id: link });
    if (count === 0) await explainUntouched(ctx, input.id);
    partnerLinked = true;
  }
  ctx.log.info("case.origin_changed", { legalCaseId: input.id, originOrganizationId: input.originOrganizationId, partnerLinked });
  return { partnerLinked };
}

/** Exceção de status (reabrir encerrado, reconsiderar rejeição): só ADMIN, com motivo, auditada pelo banco. */
export async function overrideCaseStatus(ctx: ServiceContext, input: OverrideStatusInput): Promise<void> {
  requireInternal(ctx);
  requireRole(ctx, "ADMIN");
  await repo.overrideStatus(ctx.db, input.id, input.status, input.reason);
  ctx.log.info("case.status_overridden", { legalCaseId: input.id, status: input.status });
}
