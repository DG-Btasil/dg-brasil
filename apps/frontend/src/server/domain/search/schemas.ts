import { z } from "zod";

/** Mínimo de caracteres para buscar (uma letra traria a carteira inteira). */
export const GLOBAL_SEARCH_MIN_LENGTH = 2;
/** Resultados por grupo (clientes, casos, processos). */
export const GLOBAL_SEARCH_GROUP_LIMIT = 5;

export const globalSearchSchema = z.object({
  q: z.string().trim().min(GLOBAL_SEARCH_MIN_LENGTH, "Digite pelo menos 2 caracteres.").max(120),
});
export type GlobalSearchInput = z.infer<typeof globalSearchSchema>;
