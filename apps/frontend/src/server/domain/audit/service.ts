import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { toPage, type Page } from "@/server/core/pagination";
import type { AuditEventDTO, PersonalDataAccessEventDTO } from "./dto";
import { accessEventFromRow, auditEventFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListAuditEventsInput, ListPersonalDataAccessInput } from "./schemas";

/**
 * Leitura da auditoria e dos acessos a dado pessoal (LGPD). Só ADMIN
 * (`audit.view`; a RLS repete a regra). Este módulo NÃO tem — e não deve
 * ganhar — operação de escrita, correção ou exclusão: a trilha é gravada pelo
 * banco, na mesma transação da mudança, e é append-only.
 */

function authorize(ctx: ServiceContext) {
  requireInternal(ctx);
  requirePermission(ctx, "audit.view");
}

const distinctActors = (rows: { actor_user_id: string | null }[]) => [...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => !!id))];

export async function listAuditEvents(ctx: ServiceContext, input: ListAuditEventsInput): Promise<Page<AuditEventDTO>> {
  authorize(ctx);
  const { rows, total } = await repo.listAuditEvents(
    ctx.db,
    {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      requestId: input.requestId,
      from: input.from,
      to: input.to,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  const names = await repo.getActorNames(ctx.db, distinctActors(rows));
  return toPage(
    rows.map((r) => auditEventFromRow(r, names)),
    total,
    input,
  );
}

export async function listPersonalDataAccessEvents(ctx: ServiceContext, input: ListPersonalDataAccessInput): Promise<Page<PersonalDataAccessEventDTO>> {
  authorize(ctx);
  const { rows, total } = await repo.listAccessEvents(
    ctx.db,
    {
      clientId: input.clientId,
      actorUserId: input.actorUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      from: input.from,
      to: input.to,
    },
    input,
    { column: input.column, ascending: input.ascending },
  );
  const names = await repo.getActorNames(ctx.db, distinctActors(rows));
  return toPage(
    rows.map((r) => accessEventFromRow(r, names)),
    total,
    input,
  );
}
