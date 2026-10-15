import type { DomainResult } from "@/server/core/errors";
import type { Page } from "@/server/core/pagination";

/** Página máxima aceita pelas listagens do servidor (`MAX_PAGE_SIZE`). */
export const ALL_PAGES_PAGE_SIZE = 50;
/** Teto de páginas (50 × 40 = 2.000 itens); acima disso o resultado volta com `hasMore`. */
export const ALL_PAGES_MAX_PAGES = 40;

/**
 * Lê TODAS as páginas de uma listagem paginada (obrigações de um contrato,
 * modelos de honorários, lançamentos, diretório da organização). As actions
 * recusam página maior que 50 — pedir 100 de uma vez quebra a tela (QA 4.3,
 * BUG-04). A 1ª página traz o total; as demais são pedidas em paralelo.
 * Erro em qualquer página devolve o erro (a tela mostra "Tentar novamente").
 * Acima do teto, devolve o que leu com `hasMore: true` (a tela avisa).
 */
export async function loadAllPages<T>(
  load: (page: number, pageSize: number) => Promise<DomainResult<Page<T>>>,
  maxPages = ALL_PAGES_MAX_PAGES,
): Promise<DomainResult<Page<T>>> {
  const first = await load(1, ALL_PAGES_PAGE_SIZE);
  if (!first.ok) return first;
  const pages = Math.min(Math.ceil(first.data.total / ALL_PAGES_PAGE_SIZE), maxPages);
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => load(i + 2, ALL_PAGES_PAGE_SIZE)));
  const failed = rest.find((r) => !r.ok);
  if (failed) return failed;
  const items = [first, ...rest].flatMap((r) => (r.ok ? r.data.items : []));
  const total = first.data.total;
  return { ok: true, data: { items, page: 1, pageSize: items.length, total, hasMore: items.length < total }, requestId: first.requestId };
}
