"use server";

import { runAction } from "@/server/core/action";
import * as service from "./service";
import { globalSearchSchema } from "./schemas";

/**
 * Busca do cabeçalho. Toda sessão liberada pode chamar; cada grupo só é
 * buscado com a permissão da lista correspondente (e a RLS de quem pede).
 * O texto vai no corpo da Server Action (POST): nunca na URL.
 */
export async function globalSearchAction(input: unknown) {
  return runAction({ name: "search.global", schema: globalSearchSchema, input, handler: service.globalSearch });
}
