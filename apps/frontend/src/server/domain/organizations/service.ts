import { can } from "@/lib/permissions";
import { PARTNER_OFFICE_STATUS_TO_DB } from "@/repositories/api/db-mappings";
import { isPartner, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { forbidden, invalidState, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { MyPartnerSettingsDTO, OrganizationUserDTO, OwnerOfficeDetailDTO, PartnerDetailDTO, PartnerListItem, PartnerStatsDTO } from "./dto";
import {
  organizationPatchPayload,
  organizationUserFromRows,
  ownerOfficeFromRows,
  ownerOfficePublicFromRow,
  ownerSettingsPatchPayload,
  partnerAdminFromRows,
  partnerInternalFromRow,
  partnerListItemFromRow,
  partnerOfficeOrgArg,
  partnerOfficeSettingsArg,
  partnerOwnOfficeFromRow,
  partnerSettingsPatchPayload,
  sharePayload,
} from "./mappers";
import * as repo from "./repository";
import type {
  ChangePartnerShareInput,
  CreatePartnerInput,
  ListOrganizationUsersInput,
  ListPartnersInput,
  SetPartnerStatusInput,
  UpdateOwnerOfficeInput,
  UpdatePartnerInput,
} from "./schemas";

/**
 * Regras de organização: escritório proprietário, parceiros e leitura de
 * integrantes. Autorização contextual aqui; RLS e triggers do banco como
 * segunda barreira — e as invariantes que o banco garante (um único OWNER,
 * OWNER não suspenso/excluído, tipo imutável, divisão somando 100, snapshot de
 * parceria imutável) NÃO são reimplementadas aqui.
 *
 * Gestão de equipe (convite, papel, status, MFA) NÃO é deste módulo: está em
 * src/server/auth/team-actions.ts (Etapa 4.1).
 */

/** Divisão, responsável e notas internas do parceiro: só quem administra parceiros (RLS: ADMIN). */
const canManagePartners = (ctx: ServiceContext) => can(ctx.session.role, "partners.manage");

/* ------------------------------------------------------------------ */
/* Escritório proprietário                                             */
/* ------------------------------------------------------------------ */

/** Equipe interna: ficha completa. Parceiro: só a identificação do escritório proprietário. */
export async function getOwnerOffice(ctx: ServiceContext): Promise<OwnerOfficeDetailDTO> {
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.view");
    const org = await repo.getOwnerOrganization(ctx.db);
    if (!org) throw notFound("Escritório não encontrado.");
    return { surface: "PARTNER", office: ownerOfficePublicFromRow(org) };
  }
  requireInternal(ctx);
  const org = await repo.getOwnerOrganization(ctx.db);
  if (!org) throw notFound("Escritório não encontrado.");
  const settings = await repo.getOwnerSettings(ctx.db, org.id);
  return { surface: "INTERNAL", office: ownerOfficeFromRows(org, settings) };
}

/** Dados institucionais do escritório proprietário (ADMIN). O id vem do banco, nunca do navegador. */
export async function updateOwnerOffice(ctx: ServiceContext, patch: UpdateOwnerOfficeInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "settings.office.edit");
  const org = await repo.getOwnerOrganization(ctx.db);
  if (!org) throw notFound("Escritório não encontrado.");

  const orgPayload = organizationPatchPayload(patch);
  if (Object.keys(orgPayload).length > 0) {
    if ((await repo.updateOrganization(ctx.db, org.id, "OWNER", orgPayload)) === 0) throw notFound("Escritório não encontrado.");
  }
  const settingsPayload = ownerSettingsPatchPayload(patch);
  if (Object.keys(settingsPayload).length > 0) await repo.upsertOwnerSettings(ctx.db, org.id, settingsPayload);
  ctx.log.info("owner_office.updated", { organizationId: org.id });
}

/* ------------------------------------------------------------------ */
/* Parceiros — equipe interna                                          */
/* ------------------------------------------------------------------ */

export async function listPartners(ctx: ServiceContext, input: ListPartnersInput): Promise<Page<PartnerListItem>> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.view");
  const { rows, total } = await repo.listPartners(
    ctx.db,
    { q: input.q, status: input.status ? PARTNER_OFFICE_STATUS_TO_DB[input.status] : undefined },
    input,
    { column: input.column, ascending: input.ascending },
  );
  // Divisão padrão só para ADMIN (e só é lida para ele: LAWYER nem consulta a tabela).
  const settings = canManagePartners(ctx) ? await repo.getPartnerSettings(ctx.db, rows.map((r) => r.id)) : [];
  const byOrg = new Map(settings.map((s) => [s.organization_id, s]));
  const stats = await partnerStats(
    ctx,
    rows.map((r) => r.id),
  );
  return toPage(
    rows.map((r) => ({ ...partnerListItemFromRow(r, byOrg.get(r.id)), stats: stats.get(r.id) })),
    total,
    input,
  );
}

const NEW_CASE_STATUSES = new Set(["SUBMITTED", "WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"]);
const ACTIVE_CASE_STATUSES = new Set(["ACCEPTED", "IN_PROGRESS"]);

/** Contadores por parceiro (casos com origem OU acesso operacional do parceiro). */
async function partnerStats(ctx: ServiceContext, ids: string[]): Promise<Map<string, PartnerStatsDTO>> {
  const { cases, requests, relationships } = await repo.partnerActivityRows(ctx.db, ids);
  const stats = new Map<string, PartnerStatsDTO>(ids.map((id) => [id, { clients: 0, newCases: 0, activeCases: 0, openRequests: 0 }]));
  for (const c of cases) {
    for (const id of new Set([c.origin_organization_id, c.partner_organization_id])) {
      const s = id ? stats.get(id) : undefined;
      if (!s) continue;
      if (NEW_CASE_STATUSES.has(c.status)) s.newCases += 1;
      if (ACTIVE_CASE_STATUSES.has(c.status)) s.activeCases += 1;
    }
  }
  for (const r of requests) {
    const s = stats.get(r.partner_organization_id);
    if (s) s.openRequests += 1;
  }
  for (const r of relationships) {
    const s = stats.get(r.organization_id);
    if (s) s.clients += 1;
  }
  return stats;
}

/** Contadores do parceiro para a ficha (equipe interna). */
export async function getPartnerStats(ctx: ServiceContext, id: string): Promise<PartnerStatsDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.view");
  if (!(await repo.getPartnerOrganization(ctx.db, id))) throw notFound("Parceiro não encontrado.");
  return (await partnerStats(ctx, [id])).get(id) as PartnerStatsDTO;
}

/**
 * Ficha do parceiro.
 *  - ADMIN: cadastro + divisão + responsável + notas internas;
 *  - LAWYER (partners.view): só o cadastro da organização;
 *  - parceiro: SÓ o próprio escritório (o da sessão). Qualquer outro id é
 *    "não encontrado" — não revela se existe.
 */
export async function getPartner(ctx: ServiceContext, id: string): Promise<PartnerDetailDTO> {
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.view");
    if (id !== ctx.session.organizationId) throw notFound("Escritório não encontrado.");
    const own = await repo.getPartnerOrganization(ctx.db, ctx.session.organizationId);
    if (!own) throw notFound("Escritório não encontrado.");
    return { access: "PARTNER", partner: partnerOwnOfficeFromRow(own) };
  }

  requireInternal(ctx);
  requirePermission(ctx, "partners.view");
  const org = await repo.getPartnerOrganization(ctx.db, id);
  if (!org) throw notFound("Parceiro não encontrado.");
  if (!canManagePartners(ctx)) return { access: "INTERNAL", partner: partnerInternalFromRow(org, ctx.session.organizationId) };
  const [settings] = await repo.getPartnerSettings(ctx.db, [id]);
  return { access: "ADMIN", partner: partnerAdminFromRows(org, settings ?? null, ctx.session.organizationId) };
}

/** Portal do Parceiro: o próprio escritório, sem receber id do navegador. */
export async function getMyPartnerOffice(ctx: ServiceContext): Promise<PartnerDetailDTO> {
  if (!isPartner(ctx)) throw forbidden();
  return getPartner(ctx, ctx.session.organizationId);
}

/**
 * Cadastro de parceiro (ADMIN): organização PARTNER (PENDING) + divisão
 * padrão, numa transação (public.create_partner_office, migration 026). O
 * tipo e a situação são fixados pelo banco — este caminho nunca cria OWNER (e
 * o índice único recusaria um segundo). A função também recusa quem não é ADMIN.
 */
export async function createPartner(ctx: ServiceContext, input: CreatePartnerInput): Promise<{ id: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.manage");
  const id = await repo.createPartnerOffice(ctx.db, partnerOfficeOrgArg(input), partnerOfficeSettingsArg(input));
  ctx.log.info("partner.created", { partnerOrganizationId: id });
  return { id };
}

/** Edição do cadastro (ADMIN). Divisão e situação têm operações próprias. */
export async function updatePartner(ctx: ServiceContext, input: UpdatePartnerInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.manage");
  const orgPayload = organizationPatchPayload(input.patch);
  if (Object.keys(orgPayload).length > 0) {
    if ((await repo.updateOrganization(ctx.db, input.id, "PARTNER", orgPayload)) === 0) throw notFound("Parceiro não encontrado.");
  } else if (!(await repo.getPartnerOrganization(ctx.db, input.id))) {
    throw notFound("Parceiro não encontrado.");
  }
  const settingsPayload = partnerSettingsPatchPayload(input.patch);
  if (Object.keys(settingsPayload).length > 0) {
    if ((await repo.updatePartnerSettings(ctx.db, input.id, settingsPayload)) === 0) throw invalidState("Parceiro sem configuração de parceria.");
  }
  ctx.log.info("partner.updated", { partnerOrganizationId: input.id });
}

/**
 * Ativa, suspende ou inativa (ADMIN). Suspenso/inativo perde todo o acesso
 * (current_membership exige organização ACTIVE). O escritório proprietário é
 * recusado pelo banco (organizations_guard) com mensagem própria.
 */
export async function setPartnerStatus(ctx: ServiceContext, input: SetPartnerStatusInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.manage");
  if ((await repo.setOrganizationStatus(ctx.db, input.id, input.status)) === 0) throw notFound("Parceiro não encontrado.");
  ctx.log.info("partner.status_changed", { partnerOrganizationId: input.id, status: input.status });
}

/**
 * Nova divisão PADRÃO (ADMIN). Vale só para casos aceitos daqui em diante:
 * cada caso aceito guarda o próprio snapshot em case_partnership_agreements,
 * que esta operação não toca. O banco audita PARTNER_SHARE_CHANGED com o
 * antes/depois e quantos acordos foram preservados.
 */
export async function changePartnerShare(ctx: ServiceContext, input: ChangePartnerShareInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.manage");
  if ((await repo.updatePartnerSettings(ctx.db, input.id, sharePayload(input.partnershipPercentage, input.ownerPercentage))) === 0) {
    throw notFound("Parceiro não encontrado.");
  }
  ctx.log.info("partner.share_changed", { partnerOrganizationId: input.id });
}

/* ------------------------------------------------------------------ */
/* Usuários (leitura)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Integrantes de uma organização (listas e seletores). Parceiro: sempre o
 * próprio escritório — `organizationId` diferente é recusado. Equipe interna:
 * o escritório proprietário; a equipe de um parceiro exige `partners.view`.
 */
export async function listOrganizationUsers(ctx: ServiceContext, input: ListOrganizationUsersInput): Promise<Page<OrganizationUserDTO>> {
  let organizationId = ctx.session.organizationId;
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.view");
    if (input.organizationId && input.organizationId !== ctx.session.organizationId) throw forbidden();
  } else {
    requireInternal(ctx);
    if (input.organizationId && input.organizationId !== ctx.session.organizationId) {
      requirePermission(ctx, "partners.view");
      organizationId = input.organizationId;
    }
  }
  const { rows, total } = await repo.listMemberships(ctx.db, organizationId, { status: input.status, role: input.role }, input, {
    column: input.column,
    ascending: input.ascending,
  });
  const profiles = await repo.getProfiles(ctx.db, [...new Set(rows.map((r) => r.user_id))]);
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return toPage(
    rows.map((m) => organizationUserFromRows(m, byId.get(m.user_id))),
    total,
    input,
  );
}

/**
 * Administrador do parceiro: divisão padrão do próprio escritório. O banco
 * deriva o escritório da sessão (sem parâmetro → sem IDOR) e recusa
 * PARTNER_USER (financeiro). Interno usa getPartner/listPartners.
 */
export async function getMyPartnerSettings(ctx: ServiceContext): Promise<MyPartnerSettingsDTO> {
  if (!isPartner(ctx)) throw forbidden();
  requirePermission(ctx, "partnerPortal.finance.view");
  const row = await repo.getMyPartnerSettings(ctx.db);
  if (!row) throw notFound("Configuração do escritório não encontrada.");
  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    partnerPercentage: Number(row.partner_percentage),
    ownerPercentage: Number(row.owner_percentage),
    activatedAt: row.activated_at,
  };
}
