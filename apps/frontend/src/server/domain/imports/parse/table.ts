import { ImportFileError } from "./errors";

/** Linha lida do arquivo: número da linha como aparece no Excel + células como texto. */
export interface RawRow {
  line: number;
  cells: string[];
}

export interface SheetTable {
  headers: string[];
  /** Linha do arquivo onde está o cabeçalho (título acima dele é ignorado). */
  headerLine: number;
  /** Só linhas com algum valor nas colunas mantidas. */
  rows: RawRow[];
}

export const MAX_COLUMNS = 200;
export const MAX_ROWS = 5000;

function letter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const filled = (r: RawRow) => r.cells.filter((c) => c.trim() !== "").length;

/**
 * Linha do cabeçalho: pula, no começo do arquivo, linhas de TÍTULO — até 2
 * células preenchidas quando a linha mais cheia das 20 primeiras tem bem
 * mais (ex.: "DEMONSTRATIVO DE VALORES" acima da tabela). Um cabeçalho
 * legítimo com menos colunas que os dados não é pulado.
 */
export function findHeaderIndex(raw: RawRow[]): number {
  const head = raw.slice(0, 20);
  const widest = Math.max(0, ...head.map(filled));
  const isTitle = (r: RawRow) => filled(r) <= 2 && filled(r) < Math.ceil(widest * 0.5);
  const i = head.findIndex((r) => !isTitle(r));
  return i < 0 ? 0 : i;
}

/**
 * Cabeçalho: ver findHeaderIndex. Coluna sem nome mas com dados vira
 * "Coluna X" (letra do Excel); sem nome e sem dados, some. Nome repetido
 * ganha " (2)", " (3)"…
 */
export function toTable(raw: RawRow[]): SheetTable {
  if (raw.length === 0) throw new ImportFileError("O arquivo está vazio.");
  const hi = findHeaderIndex(raw);
  const header = raw[hi]!;
  const data = raw.slice(hi + 1);
  const width = Math.max(header.cells.length, ...data.map((r) => r.cells.length));
  const keep: number[] = [];
  const names: string[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < width; i++) {
    let name = (header.cells[i] ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const hasData = data.some((r) => (r.cells[i] ?? "").trim() !== "");
    if (!name && !hasData) continue;
    if (!name) name = `Coluna ${letter(i)}`;
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n > 1) name = `${name} (${n})`;
    keep.push(i);
    names.push(name);
  }
  if (names.length === 0) throw new ImportFileError("Não encontramos o cabeçalho (a linha com os nomes das colunas).");
  if (names.length > MAX_COLUMNS) throw new ImportFileError(`A planilha tem ${names.length} colunas; o limite é ${MAX_COLUMNS}. Apague as colunas que não serão importadas.`);
  const rows = data
    .map((r) => ({ line: r.line, cells: keep.map((i) => (r.cells[i] ?? "").trim()) }))
    .filter((r) => r.cells.some((c) => c !== ""));
  if (rows.length === 0) throw new ImportFileError("A planilha não tem linhas de dados abaixo do cabeçalho.");
  if (rows.length > MAX_ROWS) throw new ImportFileError(`A planilha tem ${rows.length.toLocaleString("pt-BR")} linhas; o limite é ${MAX_ROWS.toLocaleString("pt-BR")} por importação. Divida o arquivo.`);
  return { headers: names, headerLine: header.line, rows };
}
