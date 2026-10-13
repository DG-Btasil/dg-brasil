"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import { enforcePartnerTaxIdLimit } from "@/server/core/rate-limit";
import * as service from "./service";
import {
  clientIdSchema,
  createClientSchema,
  inactivateClientSchema,
  listClientsSchema,
  lookupClientSchema,
  updateClientBasicsSchema,
  updateClientSchema,
} from "./schemas";

/**
 * Server Actions de Cliente — a única porta do navegador para este domínio.
 * Cada uma: sessão + permissão (runAction) → Zod → service. O input é
 * `unknown` de propósito: nada do navegador é confiado sem passar no schema.
 */

export async function listClientsAction(input: unknown) {
  return runAction({ name: "clients.list", schema: listClientsSchema, input, handler: service.listClients });
}

export async function getClientAction(input: unknown) {
  return runAction({ name: "clients.get", schema: clientIdSchema, input, handler: (ctx, { id }) => service.getClient(ctx, id) });
}

export async function lookupClientDocumentAction(input: unknown) {
  return runAction({
    name: "clients.lookup",
    schema: lookupClientSchema,
    input,
    // Parceiro: limite de taxa ANTES do service (best-effort, na aplicação — ver core/rate-limit.ts).
    handler: (ctx, { document }) => {
      enforcePartnerTaxIdLimit(ctx);
      return service.lookupClientDocument(ctx, document);
    },
  });
}

export async function createClientAction(input: unknown) {
  return runAction({ name: "clients.create", permission: "clients.edit", schema: createClientSchema, input, handler: service.createClient });
}

export async function updateClientAction(input: unknown) {
  return runAction({ name: "clients.update", permission: "clients.edit", schema: updateClientSchema, input, handler: service.updateClient });
}

export async function updateClientBasicsAction(input: unknown) {
  return runAction({ name: "clients.update_basics", schema: updateClientBasicsSchema, input, handler: service.updateClientBasics });
}

export async function inactivateClientAction(input: unknown) {
  return runAction({ name: "clients.inactivate", permission: "clients.edit", schema: inactivateClientSchema, input, handler: service.inactivateClient });
}

export async function reactivateClientAction(input: unknown) {
  return runAction({ name: "clients.reactivate", permission: "clients.edit", schema: clientIdSchema, input, handler: (ctx, { id }) => service.reactivateClient(ctx, id) });
}

export async function removeClientAction(input: unknown) {
  return runAction({ name: "clients.remove", permission: "clients.delete", schema: clientIdSchema, input, handler: (ctx, { id }) => service.removeClient(ctx, id) });
}

export async function listClientRelationshipsAction(input: unknown) {
  return runAction({
    name: "clients.relationships",
    schema: z.object({ clientId: clientIdSchema.shape.id }),
    input,
    handler: (ctx, { clientId }) => service.listClientRelationships(ctx, clientId),
  });
}
