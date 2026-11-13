import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { toPage, type Page } from "@/server/core/pagination";
import type { RestoreResultDTO, TrashItemDTO } from "./dto";
import { restoreResultFromRow, trashItemFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListTrashInput, RestoreTrashInput } from "./schemas";

/**
 * Lixeira: clientes, processos e documentos excluídos (exclusão lógica), com
 * "Restaurar". Só ADMIN (`trash.manage`); o banco (066) confere de novo, grava
 * a auditoria e é quem decide se a restauração pode acontecer. Não existe
 * exclusão definitiva.
 */

export async function listTrash(ctx: ServiceContext, input: ListTrashInput): Promise<Page<TrashItemDTO>> {
  requireInternal(ctx);
  requirePermission(ctx, "trash.manage");
  const { rows, total } = await repo.listTrash(ctx.db, input.kind, input.q, input);
  return toPage(rows.map(trashItemFromRow), total, input);
}

export async function restoreFromTrash(ctx: ServiceContext, input: RestoreTrashInput): Promise<RestoreResultDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "trash.manage");
  const result = restoreResultFromRow(input.kind, await repo.restore(ctx.db, input.kind, input.id));
  ctx.log.info("trash.restored", { kind: input.kind, entityId: input.id });
  return result;
}
