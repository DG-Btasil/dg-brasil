"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { listTrashSchema, restoreTrashSchema } from "./schemas";

/** Server Actions da Lixeira: só ADMIN (`trash.manage`); o banco (066) confere de novo. */

export async function listTrashAction(input: unknown) {
  return runAction({ name: "trash.list", permission: "trash.manage", schema: listTrashSchema, input, handler: service.listTrash });
}

export async function restoreFromTrashAction(input: unknown) {
  return runAction({ name: "trash.restore", permission: "trash.manage", schema: restoreTrashSchema, input, handler: service.restoreFromTrash });
}
