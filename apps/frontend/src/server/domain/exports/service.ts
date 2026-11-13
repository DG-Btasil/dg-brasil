import { requireInternal, requirePermission, type ServiceContext } from "@/server/core/context";
import { unwrap } from "@/server/core/db-errors";
import type { PageInput } from "@/server/core/pagination";
import { buildCsv, type CsvColumn } from "./csv";

/**
 * Exportação de planilha (CSV) — infraestrutura única para todas as listas.
 *
 * Uma lista liga a exportação com poucas linhas (exemplo em docs/backend.md):
 *
 *   1. busca as linhas com os MESMOS filtros da tela (`collectForExport`);
 *   2. chama `exportCsv({ kind, fileName, columns, rows, filters, ... })`;
 *   3. expõe a Server Action e põe o `<ExportButton>` no cabeçalho.
 *
 * Regras que ficam AQUI (e não em cada lista): só ADMIN (`data.export`; o
 * banco confere de novo), limite de linhas, e o registro na auditoria ANTES de
 * o arquivo sair — DATA_EXPORTED com o tipo, os filtros e a quantidade de
 * linhas, nunca o conteúdo (migration 066). Se o registro falha, não há arquivo.
 */

/** Limite de linhas por arquivo. Passou disso, a planilha sai cortada e a tela avisa. */
export const EXPORT_MAX_ROWS = 5000;
/** Linhas por consulta (o PostgREST do projeto devolve no máximo 1000). */
export const EXPORT_CHUNK_SIZE = 500;

export interface ExportFileDTO {
  fileName: string;
  /** CSV sem BOM (o navegador põe, com `csvBlob`). */
  content: string;
  rowCount: number;
  /** Quantos registros os filtros alcançam (pode ser mais que `rowCount`). */
  total: number;
  truncated: boolean;
  limit: number;
}

export type ExportFilterValue = string | number | boolean | null | undefined;

/**
 * Filtros como vão para a auditoria: só valores simples e preenchidos. O texto
 * da busca NUNCA é gravado (pode ser nome ou CPF/CNPJ): vira `search: true`.
 */
export function auditFilters(filters: Record<string, ExportFilterValue>, searchKeys: readonly string[] = ["q", "search"]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (searchKeys.includes(key)) out.search = true;
    else out[key] = typeof value === "string" ? value.slice(0, 80) : value;
  }
  return out;
}

/**
 * Junta as linhas de uma listagem paginada até o limite da exportação.
 * `fetchPage` é a mesma consulta da lista (mesmos filtros e ordem), com a
 * página que este laço pede.
 */
export async function collectForExport<R>(
  fetchPage: (page: PageInput) => Promise<{ rows: R[]; total: number }>,
  limit = EXPORT_MAX_ROWS,
  chunkSize = EXPORT_CHUNK_SIZE,
): Promise<{ rows: R[]; total: number; truncated: boolean }> {
  const rows: R[] = [];
  let total = 0;
  for (let page = 1; rows.length < limit; page++) {
    const chunk = await fetchPage({ page, pageSize: chunkSize });
    total = chunk.total;
    rows.push(...chunk.rows);
    if (chunk.rows.length < chunkSize || rows.length >= total) break;
  }
  const kept = rows.slice(0, limit);
  return { rows: kept, total: Math.max(total, kept.length), truncated: total > kept.length };
}

/** Parte uma lista em blocos (para `in (...)` com muitos ids). */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Consulta auxiliar da exportação em blocos de ids, com poucas chamadas ao
 * mesmo tempo (uma planilha de 5.000 linhas não vira 50 consultas simultâneas).
 * Devolve tudo junto, na ordem dos blocos.
 */
export async function mapChunks<T, R>(items: readonly T[], size: number, fn: (chunk: T[]) => Promise<R[]>, concurrency = 5): Promise<R[]> {
  const chunks = chunked(items, size);
  const out: R[] = [];
  for (const wave of chunked(chunks, Math.max(1, concurrency))) {
    for (const part of await Promise.all(wave.map(fn))) out.push(...part);
  }
  return out;
}

const today = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);

export async function exportCsv<R>(
  ctx: ServiceContext,
  input: {
    /** Tipo da lista, em minúsculas (vai para a auditoria): "clients", "processes", "deadlines"... */
    kind: string;
    /** Começo do nome do arquivo, em português: "clientes" → clientes-2026-11-13.csv. */
    fileName: string;
    columns: readonly CsvColumn<R>[];
    rows: readonly R[];
    /** Filtros da tela (o texto de busca não é gravado). */
    filters: Record<string, ExportFilterValue>;
    /** Total que os filtros alcançam e se o limite cortou (de `collectForExport`). */
    total?: number;
    truncated?: boolean;
  },
  now = new Date(),
): Promise<ExportFileDTO> {
  requireInternal(ctx);
  requirePermission(ctx, "data.export");
  const truncated = input.truncated ?? false;
  const content = buildCsv(input.columns, input.rows);
  unwrap(
    await ctx.db.rpc("record_data_export", {
      p_kind: input.kind,
      p_filters: auditFilters(input.filters),
      p_row_count: input.rows.length,
      p_truncated: truncated,
    }),
  );
  ctx.log.info("export.csv", { kind: input.kind, rows: input.rows.length, truncated });
  return {
    fileName: `${input.fileName}-${today(now)}.csv`,
    content,
    rowCount: input.rows.length,
    total: input.total ?? input.rows.length,
    truncated,
    limit: EXPORT_MAX_ROWS,
  };
}
