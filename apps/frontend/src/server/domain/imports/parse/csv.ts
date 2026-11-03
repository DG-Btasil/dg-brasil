import type { RawRow } from "./table";

/**
 * CSV: UTF-8 (com ou sem BOM) ou, se não for UTF-8 válido, Windows-1252 — o
 * "CSV (separado por vírgulas)" que o Excel em português salva. Separador
 * detectado na primeira linha com conteúdo: ";", "," ou tabulação. Aspas
 * duplas pelo RFC 4180 (inclusive quebra de linha dentro de aspas).
 *
 * `line` = número do registro no arquivo (1 = primeira linha), como o Excel
 * numera ao abrir o CSV; linhas em branco contam.
 */

export function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== "") ?? "";
  const count = (d: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) n++;
    }
    return n;
  };
  const candidates: [string, number][] = [
    [";", count(";")],
    [",", count(",")],
    ["\t", count("\t")],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]![1] > 0 ? candidates[0]![0] : ";";
}

export function parseCsv(text: string, delimiter = detectDelimiter(text)): RawRow[] {
  const rows: RawRow[] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  const push = () => {
    record.push(field.trim());
    field = "";
  };
  const end = () => {
    push();
    if (record.some((c) => c !== "")) rows.push({ line: recordLine, cells: record });
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === "\n") line++;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "") {
      field = "";
      quoted = true;
    } else if (ch === delimiter) push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      end();
      line++;
      recordLine = line;
    } else field += ch;
  }
  if (field !== "" || record.length > 0) end();
  return rows;
}
