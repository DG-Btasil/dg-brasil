"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { listAuditEventsSchema, listPersonalDataAccessSchema } from "./schemas";

/**
 * Server Actions da auditoria: SÓ leitura, só ADMIN (`audit.view`). Não há
 * — de propósito — nenhuma ação que grave, corrija ou apague evento.
 */

export async function listAuditEventsAction(input: unknown) {
  return runAction({ name: "audit.list", permission: "audit.view", schema: listAuditEventsSchema, input, handler: service.listAuditEvents });
}

export async function listPersonalDataAccessEventsAction(input: unknown) {
  return runAction({
    name: "audit.personal_data_access.list",
    permission: "audit.view",
    schema: listPersonalDataAccessSchema,
    input,
    handler: service.listPersonalDataAccessEvents,
  });
}
