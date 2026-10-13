import { z } from "zod";

/**
 * Paginação server-side. Toda listagem potencialmente grande usa isto:
 * página 1-based, 25 itens por padrão, no máximo 50. Ordenação só por campos
 * de uma WHITELIST (nunca nome de coluna vindo do navegador).
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 50;

export const pageInputSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageInput = z.infer<typeof pageInputSchema>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/** Intervalo inclusivo para `.range(from, to)` do Supabase. */
export function toRange(input: PageInput): { from: number; to: number } {
  const from = (input.page - 1) * input.pageSize;
  return { from, to: from + input.pageSize - 1 };
}

export function toPage<T>(items: T[], total: number | null, input: PageInput): Page<T> {
  const count = total ?? items.length;
  return { items, page: input.page, pageSize: input.pageSize, total: count, hasMore: input.page * input.pageSize < count };
}

/**
 * Ordenação por whitelist. `fields` mapeia o nome PÚBLICO (o que o front manda)
 * para a coluna real. Qualquer outro valor é recusado pelo schema.
 */
export function sortSchema<const F extends Record<string, string>>(fields: F, defaultField: keyof F & string, defaultDirection: "asc" | "desc" = "desc") {
  const keys = Object.keys(fields) as [keyof F & string, ...(keyof F & string)[]];
  return z
    .object({
      sortBy: z.enum(keys).default(defaultField as never),
      sortDirection: z.enum(["asc", "desc"]).default(defaultDirection),
    })
    .transform((v) => ({ column: fields[v.sortBy as keyof F] as string, ascending: v.sortDirection === "asc" }));
}
