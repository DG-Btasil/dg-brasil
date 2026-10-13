import { randomUUID } from "node:crypto";
import { PARTNER_REQUEST_TYPE_TO_DB } from "@/repositories/api/db-mappings";
import { isPartner, requireAnyPermission, requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { businessRule, invalidState, notFound, validation } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { PartnerRequestDetailDTO, PartnerRequestListItem } from "./dto";
import { insertRow, internalDetailFromRows, listItemFromRow, partnerDetailFromRows } from "./mappers";
import * as repo from "./repository";
import type { AddPartnerRequestMessageInput, ClosePartnerRequestInput, CreatePartnerRequestInput, ListPartnerRequestsInput } from "./schemas";

/**
 * Solicitações da equipe ao escritório parceiro (pendência operacional).
 *
 * Quem vê: equipe interna, todas; parceiro, só as do próprio escritório (RLS
 * partner_requests_select — o service nunca filtra por organização vinda do
 * navegador). Quem escreve: equipe interna cria/encerra; parceiro só responde
 * (o trigger private.partner_requests_guard recusa qualquer outra mudança).
 * Registro de outro escritório é sempre "não encontrado".
 */

const OPEN_STATUSES = ["OPEN", "ANSWERED"] as const;
const NOT_FOUND_MESSAGE = "Solicitação não encontrada.";

function requireViewer(ctx: ServiceContext) {
  requireAnyPermission(ctx, "partnerRequests.manage", "partnerPortal.requests.respond");
}

export async function listPartnerRequests(ctx: ServiceContext, input: ListPartnerRequestsInput): Promise<Page<PartnerRequestListItem>> {
  requireViewer(ctx);
  const surface = isPartner(ctx) ? "PARTNER" : "INTERNAL";
  const { rows, total } = await repo.list(
    ctx.db,
    {
      status: input.status,
      type: input.type ? PARTNER_REQUEST_TYPE_TO_DB[input.type] : undefined,
      legalCaseId: input.legalCaseId,
      // Parceiro não escolhe escritório: a RLS já devolve só o dele.
      partnerOrganizationId: surface === "INTERNAL" ? input.partnerOrganizationId : undefined,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  return toPage(
    rows.map((r) => listItemFromRow(r, surface)),
    total,
    input,
  );
}

/** Solicitação com a conversa. DTO do parceiro sem dado interno (autor interno, documento que ele não abre). */
export async function getPartnerRequest(ctx: ServiceContext, id: string): Promise<PartnerRequestDetailDTO> {
  requireViewer(ctx);
  const row = await repo.getById(ctx.db, id);
  if (!row) throw notFound(NOT_FOUND_MESSAGE);
  const messages = await repo.listMessages(ctx.db, id);
  const authorIds = [...new Set(messages.map((m) => m.author_id).filter((a): a is string => !!a))];
  const [partnerAuthorIds, names] = await Promise.all([
    repo.partnerMemberIds(ctx.db, row.partner_organization_id, authorIds),
    repo.profileNames(ctx.db, authorIds),
  ]);
  if (isPartner(ctx)) {
    const docIds = [...new Set(messages.map((m) => m.document_id).filter((d): d is string => !!d))];
    const readable = await repo.readableDocumentIds(ctx.db, docIds);
    return { surface: "PARTNER", request: partnerDetailFromRows(row, messages, partnerAuthorIds, names, readable) };
  }
  return { surface: "INTERNAL", request: internalDetailFromRows(row, messages, partnerAuthorIds, names) };
}

/**
 * Equipe interna cria a solicitação. O parceiro destinatário é o parceiro
 * OPERACIONAL do caso (lido no banco); o trigger do banco confere de novo.
 */
export async function createPartnerRequest(ctx: ServiceContext, input: CreatePartnerRequestInput): Promise<{ id: string }> {
  requireInternal(ctx);
  requirePermission(ctx, "partnerRequests.manage");
  const legalCase = await repo.getCase(ctx.db, input.legalCaseId);
  if (!legalCase || legalCase.deleted_at) throw notFound("Caso não encontrado.");
  if (!legalCase.partner_organization_id) throw businessRule("Este caso não tem escritório parceiro para receber a solicitação.");
  const id = randomUUID();
  await repo.insert(ctx.db, insertRow(id, input, legalCase.partner_organization_id));
  ctx.log.info("partner_request.created", { partnerRequestId: id, legalCaseId: input.legalCaseId });
  return { id };
}

/**
 * Mensagem na conversa — RPC answer_partner_request (026): mensagem + situação
 * numa transação. Parceiro: responde a do próprio escritório (OPEN → ANSWERED).
 * Interno: comenta e, com `reopen`, pede nova resposta (ANSWERED → OPEN).
 * Encerrada não recebe mensagem (banco). Id da mensagem gerado no servidor.
 */
export async function addPartnerRequestMessage(ctx: ServiceContext, input: AddPartnerRequestMessageInput): Promise<{ id: string; status: "OPEN" | "ANSWERED" }> {
  const partner = isPartner(ctx);
  if (partner) requirePermission(ctx, "partnerPortal.requests.respond");
  else {
    requireInternal(ctx);
    requirePermission(ctx, "partnerRequests.manage");
  }

  // Regra extra do interno: anexo só PARTNER_VISIBLE do cliente do caso. Do
  // parceiro, o banco já exige documento que ele abre.
  if (input.documentId && !partner) {
    const request = await repo.getById(ctx.db, input.requestId);
    if (!request) throw notFound(NOT_FOUND_MESSAGE);
    await assertAttachableDocument(ctx, input.documentId, request.legal_case_id);
  }

  const id = randomUUID();
  const status = await repo.answer(ctx.db, {
    requestId: input.requestId,
    messageId: id,
    body: input.message,
    documentId: input.documentId ?? null,
    reopen: !partner && input.reopen,
  });
  ctx.log.info("partner_request.message_added", { partnerRequestId: input.requestId, messageId: id, status });
  return { id, status: status as "OPEN" | "ANSWERED" };
}

/**
 * Encerra (RESOLVED) ou cancela. Só equipe interna; só de OPEN/ANSWERED
 * (UPDATE condicional: dois cliques, um ganha). O trigger de transição da 026
 * recusa reabrir encerrada mesmo pela API direta.
 */
export async function closePartnerRequest(ctx: ServiceContext, input: ClosePartnerRequestInput): Promise<void> {
  requireInternal(ctx);
  requirePermission(ctx, "partnerRequests.manage");
  const changed = await repo.updateStatus(ctx.db, input.id, input.resolution, [...OPEN_STATUSES]);
  if (changed === 0) {
    const current = await repo.getById(ctx.db, input.id);
    if (!current) throw notFound(NOT_FOUND_MESSAGE);
    throw invalidState("A solicitação já está encerrada.");
  }
  ctx.log.info("partner_request.closed", { partnerRequestId: input.id, status: input.resolution });
}

/**
 * Documento anexado pela equipe interna: do cliente do caso e visível ao
 * parceiro — anexar documento INTERNAL a uma conversa com o parceiro seria
 * vazamento (o banco só confere que o autor acessa o documento).
 */
async function assertAttachableDocument(ctx: ServiceContext, documentId: string, legalCaseId: string): Promise<void> {
  const doc = await repo.getDocument(ctx.db, documentId);
  if (!doc || doc.deleted_at) throw validation({ documentId: ["Documento não encontrado."] });
  if (doc.visibility !== "PARTNER_VISIBLE") throw businessRule("Só documento visível ao parceiro pode ser anexado à solicitação.");
  const legalCase = await repo.getCase(ctx.db, legalCaseId);
  if (!legalCase || legalCase.client_id !== doc.client_id) throw businessRule("O documento não é do cliente deste caso.");
}
