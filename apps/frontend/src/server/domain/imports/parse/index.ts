import { decodeText, parseCsv } from "./csv";
import { ImportFileError } from "./errors";
import { toTable, type SheetTable } from "./table";
import { openXlsx } from "./xlsx";

export { ImportFileError } from "./errors";
export type { RawRow, SheetTable } from "./table";
export { MAX_COLUMNS, MAX_ROWS } from "./table";

export interface ReadResult extends SheetTable {
  /** XLSX: abas visíveis (para trocar de aba). CSV: vazio. */
  sheets: string[];
  sheetName?: string;
}

/**
 * Lê CSV ou XLSX. XLSX sem aba pedida: a primeira aba VISÍVEL com dados.
 * Erro de leitura → ImportFileError com mensagem para o usuário.
 */
export function readSpreadsheet(bytes: Uint8Array, fileType: "CSV" | "XLSX", sheetName?: string | null): ReadResult {
  if (bytes.byteLength === 0) throw new ImportFileError("O arquivo está vazio.");
  if (fileType === "CSV") {
    // .xlsx renomeado para .csv (ou o contrário) acontece: avisa em vez de ler lixo.
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new ImportFileError("Este arquivo é um Excel (.xlsx), não um CSV. Envie com a extensão .xlsx.");
    return { ...toTable(parseCsv(decodeText(bytes))), sheets: [] };
  }
  const book = openXlsx(bytes);
  const visible = book.sheets.filter((s) => !s.hidden).map((s) => s.name);
  const names = visible.length ? visible : book.sheets.map((s) => s.name);
  if (sheetName) {
    if (!book.sheets.some((s) => s.name === sheetName)) throw new ImportFileError(`A aba "${sheetName}" não existe no arquivo.`);
    return { ...toTable(book.read(sheetName)), sheets: names, sheetName };
  }
  for (const name of names) {
    const raw = book.read(name);
    if (raw.length >= 2) return { ...toTable(raw), sheets: names, sheetName: name };
  }
  throw new ImportFileError("Nenhuma aba da planilha tem cabeçalho e linhas de dados.");
}
