import { isPartner, requireAnyPermission, requireInternal, requirePermission, requireRole, type ServiceContext } from "@/server/core/context";
import { duplicateClient, notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { ClientDetailDTO, ClientListItem, ClientLookupDTO, ClientRelationshipDTO, CompanyPeopleResultDTO } from "./dto";
import {
  basicsPayload,
  companyPeoplePayload,
  createPayload,
  internalClientFromRows,
  listItemFromRow,
  partnerClientFromRow,
  relationshipFromRow,
  updatePayload,
} from "./mappers";
import * as repo from "./repository";
import type { CreateClientInput, ListClientsInput, ListRelatedClientsInput, ReplaceCompanyPeopleInput, UpdateClientBasicsInput, UpdateClientInput } from "./schemas";

/**
 * Regras de Cliente. Autorização contextual aqui; RLS e funções do banco
 * (private.save_client, partner_*) como segunda barreira — e as invariantes
 * de dado (CPF/CNPJ único, origem permitida, só ADMIN corrige documento)
 * continuam NO BANCO, não reimplementadas aqui.
 */

export async function listClients(ctx: ServiceContext, input: ListClientsInput): Promise<Page<ClientListItem>> {
  requirePermission(ctx, "clients.view");
  const partner = isPartner(ctx);
  const { rows, total } = await repo.listDirectory(
    ctx.db,
    {
      q: input.q,
      status: input.status,
      kind: input.kind,
      // Parceiro não filtra por responsável interno; a RLS já limita aos próprios clientes.
      originOrganizationId: input.originOrganizationId,
      responsibleUserId: partner ? undefined : input.responsibleUserId,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  const items = rows.map((r) => listItemFromRow(r, ctx.session));
  if (partner && items.length > 0) {
    // Contagens do escopo do escritório (036): uma consulta para a página inteira.
    const counts = await repo.partnerClientCounts(
      ctx.db,
      items.map((i) => i.id),
    );
    for (const item of items) item.partnerCounts = counts.get(item.id) ?? { cases: 0, processes: 0, openRequests: 0, requestedDocuments: 0 };
  }
  return toPage(items, total, input);
}

/** Clientes relacionados a um escritório parceiro (equipe interna com partners.view). */
export async function listRelatedClients(ctx: ServiceContext, input: ListRelatedClientsInput): Promise<Page<ClientListItem>> {
  requireInternal(ctx);
  requirePermission(ctx, "partners.view");
  const { rows, total } = await repo.listRelatedDirectory(ctx.db, input.organizationId, input);
  return toPage(
    rows.map((r) => listItemFromRow(r, ctx.session)),
    total,
    input,
  );
}

/** Ficha do cliente. Registra o acesso a dado pessoal (LGPD) antes de devolver. */
export async function getClient(ctx: ServiceContext, id: string): Promise<ClientDetailDTO> {
  requirePermission(ctx, "clients.view");
  const partner = isPartner(ctx);
  const row = await repo.getDetail(ctx.db, id, partner ? "PARTNER" : "INTERNAL");
  if (!row) throw notFound("Cliente não encontrado.");
  await repo.recordDetailAccess(ctx.db, id);
  if (partner) return { surface: "PARTNER", client: partnerClientFromRow(row, ctx.session.organizationId) };
  const internal = await repo.getInternalDetails(ctx.db, id);
  return { surface: "INTERNAL", client: internalClientFromRows(row, internal, ctx.session.organizationId) };
}

/**
 * CPF/CNPJ já existe? Interno: devolve o id. Parceiro: NOT_FOUND,
 * ALREADY_RELATED (com id, porque já é dele) ou EXISTS — sem id, nome ou
 * escritório (private.partner_lookup_client, que também audita a consulta).
 */
export async function lookupClientDocument(ctx: ServiceContext, digits: string): Promise<ClientLookupDTO> {
  if (isPartner(ctx)) {
    requirePermission(ctx, "partnerPortal.clients.create");
    const r = await repo.partnerLookup(ctx.db, digits);
    if (r.status === "ALREADY_RELATED" && r.client_id) return { status: "ALREADY_RELATED", clientId: r.client_id };
    return r.status === "EXISTS" ? { status: "EXISTS" } : { status: "NOT_FOUND" };
  }
  requirePermission(ctx, "clients.view");
  const found = await repo.findIdByDocument(ctx.db, digits);
  return found ? { status: "FOUND", clientId: found.id } : { status: "NOT_FOUND" };
}

/** Cadastro interno. Parceiro cadastra cliente pelo envio de caso (partner_submit_case). */
export async function createClient(ctx: ServiceContext, input: CreateClientInput): Promise<{ id: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "clients.edit");
  const digits = input.kind === "INDIVIDUAL" ? input.cpf : input.cnpj;
  // Mensagem amigável antes de tentar; a unique do banco cobre a corrida (double-click).
  if (await repo.findIdByDocument(ctx.db, digits)) throw duplicateClient();
  const payload = createPayload({ ...input, responsibleUserId: input.responsibleUserId ?? ctx.session.userId });
  const id = await repo.save(ctx.db, null, payload);
  ctx.log.info("client.created", { clientId: id });
  return { id };
}

export async function updateClient(ctx: ServiceContext, input: UpdateClientInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "clients.edit");
  // Corrigir CPF/CNPJ é decisão de ADMIN (o trigger do banco também recusa).
  if (input.patch.document !== undefined) requireRole(ctx, "ADMIN");
  await repo.save(ctx.db, input.id, updatePayload(input.patch));
  ctx.log.info("client.updated", { clientId: input.id });
}

/** Portal do parceiro: contato e endereço de cliente que ele acessa. */
export async function updateClientBasics(ctx: ServiceContext, input: UpdateClientBasicsInput): Promise<void> {
  requireAnyPermission(ctx, "partnerPortal.clients.edit", "clients.edit");
  await repo.save(ctx.db, input.id, basicsPayload(input));
  ctx.log.info("client.basics_updated", { clientId: input.id });
}

export async function inactivateClient(ctx: ServiceContext, input: { id: string; reason?: string; note?: string }): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "clients.edit");
  await repo.setStatus(ctx.db, input.id, "INACTIVE", input.reason, input.note);
}

export async function reactivateClient(ctx: ServiceContext, id: string): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "clients.edit");
  await repo.setStatus(ctx.db, id, "ACTIVE");
}

/**
 * Representantes e sócios de PJ: o servidor manda o ESTADO FINAL das listas e
 * o banco substitui tudo numa transação (028), conferindo equipe interna,
 * aal2, cliente PJ acessível e que cada `id` é deste cliente. Parceiro nunca.
 */
export async function replaceCompanyPeople(ctx: ServiceContext, input: ReplaceCompanyPeopleInput): Promise<CompanyPeopleResultDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "clients.edit");
  const counts = await repo.replaceCompanyPeople(ctx.db, input.clientId, companyPeoplePayload(input));
  const r = counts.representatives;
  const s = counts.shareholders;
  ctx.log.info("client.company_people_replaced", {
    clientId: input.clientId,
    representativesAdded: r.added,
    representativesUpdated: r.updated,
    representativesRemoved: r.removed,
    partnersAdded: s.added,
    partnersUpdated: s.updated,
    partnersRemoved: s.removed,
  });
  return { representatives: counts.representatives, partners: counts.shareholders };
}

/** Exclusão lógica (ADMIN). Processos não são apagados: voltam para a lista de pendências. */
export async function removeClient(ctx: ServiceContext, id: string): Promise<{ affectedProcessIds: string[] }> {
  requirePermission(ctx, "clients.delete");
  const affectedProcessIds = await repo.listLinkedProcessIds(ctx.db, id);
  await repo.softDelete(ctx.db, id);
  ctx.log.info("client.deleted", { clientId: id, affectedProcesses: affectedProcessIds.length });
  return { affectedProcessIds };
}

/** Escritórios ligados ao cliente. Parceiro só enxerga o próprio vínculo (RLS). */
export async function listClientRelationships(ctx: ServiceContext, clientId: string): Promise<ClientRelationshipDTO[]> {
  requirePermission(ctx, "clients.view");
  return (await repo.listRelationships(ctx.db, clientId)).map(relationshipFromRow);
}
