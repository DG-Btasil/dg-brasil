"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import {
  addPartnerRequestMessageSchema,
  closePartnerRequestSchema,
  createPartnerRequestSchema,
  listPartnerRequestsSchema,
  partnerRequestIdSchema,
} from "./schemas";

/**
 * Server Actions de solicitação a parceiro — a única porta do navegador para
 * este domínio. Listar, abrir e responder servem às duas superfícies (o
 * service escolhe a permissão e o DTO pela sessão); criar e encerrar são da
 * equipe interna.
 */

export async function listPartnerRequestsAction(input: unknown) {
  return runAction({ name: "partner_requests.list", schema: listPartnerRequestsSchema, input, handler: service.listPartnerRequests });
}

export async function getPartnerRequestAction(input: unknown) {
  return runAction({ name: "partner_requests.get", schema: partnerRequestIdSchema, input, handler: (ctx, { id }) => service.getPartnerRequest(ctx, id) });
}

export async function createPartnerRequestAction(input: unknown) {
  return runAction({
    name: "partner_requests.create",
    permission: "partnerRequests.manage",
    schema: createPartnerRequestSchema,
    input,
    handler: service.createPartnerRequest,
  });
}

/** Mensagem/resposta: parceiro responde a do próprio escritório; equipe interna comenta ou pede nova resposta. */
export async function addPartnerRequestMessageAction(input: unknown) {
  return runAction({ name: "partner_requests.message", schema: addPartnerRequestMessageSchema, input, handler: service.addPartnerRequestMessage });
}

export async function closePartnerRequestAction(input: unknown) {
  return runAction({
    name: "partner_requests.close",
    permission: "partnerRequests.manage",
    schema: closePartnerRequestSchema,
    input,
    handler: service.closePartnerRequest,
  });
}
