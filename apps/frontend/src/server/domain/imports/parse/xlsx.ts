import { ImportFileError } from "./errors";
import type { RawRow } from "./table";
import { openZip, type ZipReader } from "./zip";

/**
 * Leitor de .xlsx (Office Open XML) suficiente para importação: abas,
 * textos compartilhados, texto embutido, números, booleanos e DATAS (célula
 * numérica com formato de data vira AAAA-MM-DD). Fórmulas: vale o último
 * valor calculado que o Excel gravou. Sem dependência externa: ZIP pelo zlib
 * do Node e XML gerado por máquina lido por expressões regulares.
 */

export interface XlsxSheetInfo {
  name: string;
  path: string;
  hidden: boolean;
}

export interface XlsxWorkbook {
  sheets: XlsxSheetInfo[];
  read(sheetName: string): RawRow[];
}

/** Uma célula além desta coluna é ignorada (proteção contra planilhas "estouradas" até XFD). */
const MAX_COLUMN_INDEX = 1024;

export function decodeXml(value: string): string {
  return value
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
      if (e === "lt") return "<";
      if (e === "gt") return ">";
      if (e === "amp") return "&";
      if (e === "quot") return '"';
      if (e === "apos") return "'";
      const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decodeXml(m[2]!);
  return out;
}

/** Texto de um <si> / <is>: junta os <t>, ignorando a fonética (<rPh>). */
function richText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]!);
  return out;
}

export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "")
    .replace(/General/gi, "");
  return /[dmy]/i.test(stripped) && !/^[#0.,%\s]*$/.test(stripped);
}

/** Número de série do Excel → AAAA-MM-DD (UTC, sem fuso). */
export function excelSerialToIso(serial: number, date1904 = false): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return undefined;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400) * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Número como o Excel gravou, sem notação científica para inteiros. */
export function numberText(raw: string): string {
  const v = raw.trim();
  if (!/e/i.test(v)) return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) ? n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 0 }) : String(n);
}

function resolveTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== ".") out.push(p);
  }
  return out.join("/");
}

function readStyles(zip: ZipReader): boolean[] {
  const xml = zip.text("xl/styles.xml");
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.numFmtId) custom.set(Number(a.numFmtId), a.formatCode ?? "");
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? "";
  const out: boolean[] = [];
  for (const m of xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)) {
    const id = Number(attrs(m[1]!).numFmtId ?? 0);
    out.push(isDateFormat(id, custom.get(id)));
  }
  return out;
}

function readSharedStrings(zip: ZipReader): string[] {
  const xml = zip.text("xl/sharedStrings.xml");
  if (!xml) return [];
  const out: string[] = [];
  for (const m of xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)) out.push(m[1] ? richText(m[1]) : "");
  return out;
}

export function openXlsx(bytes: Uint8Array): XlsxWorkbook {
  const zip = openZip(bytes);
  const workbook = zip.text("xl/workbook.xml");
  if (!workbook) throw new ImportFileError("O arquivo não é uma planilha do Excel (.xlsx). Abra no Excel e salve como .xlsx.");
  const rels = zip.text("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!);
    if (a.Id && a.Target) targets.set(a.Id, resolveTarget(a.Target));
  }
  const date1904 = /<workbookPr\b[^>]*\bdate1904\s*=\s*"(1|true)"/i.test(workbook);
  const sheets: XlsxSheetInfo[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]!);
    const rid = a["r:id"] ?? Object.entries(a).find(([k]) => k.endsWith(":id"))?.[1];
    const path = rid ? targets.get(rid) : undefined;
    if (a.name && path && zip.has(path)) sheets.push({ name: a.name, path, hidden: a.state === "hidden" || a.state === "veryHidden" });
  }
  if (sheets.length === 0) throw new ImportFileError("A planilha não tem abas com dados.");

  let shared: string[] | undefined;
  let dateStyles: boolean[] | undefined;

  return {
    sheets,
    read(sheetName) {
      const sheet = sheets.find((s) => s.name === sheetName);
      if (!sheet) throw new ImportFileError(`A aba "${sheetName}" não existe no arquivo.`);
      shared ??= readSharedStrings(zip);
      dateStyles ??= readStyles(zip);
      const xml = zip.text(sheet.path) ?? "";
      const data = /<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? "";
      const rows: RawRow[] = [];
      let nextLine = 1;
      for (const rm of data.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const ra = attrs(rm[1]!);
        const line = ra.r ? Number(ra.r) : nextLine;
        nextLine = line + 1;
        const body = rm[2] ?? "";
        const cells: string[] = [];
        let nextCol = 0;
        for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const ca = attrs(cm[1]!);
          const col = ca.r ? columnIndex(ca.r) : nextCol;
          nextCol = col + 1;
          if (col < 0 || col > MAX_COLUMN_INDEX) continue;
          const inner = cm[2] ?? "";
          const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          let value = "";
          switch (ca.t) {
            case "s":
              value = shared[Number(v)] ?? "";
              break;
            case "inlineStr":
              value = richText(/<is>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
              break;
            case "str":
              value = v !== undefined ? decodeXml(v) : "";
              break;
            case "b":
              value = v === "1" ? "VERDADEIRO" : v === "0" ? "FALSO" : "";
              break;
            case "e":
              value = "";
              break;
            case "d":
              value = v ? decodeXml(v).replace(/T00:00(:00(\.0+)?)?Z?$/, "") : "";
              break;
            default:
              if (v === undefined || v.trim() === "") value = "";
              else if (ca.s !== undefined && dateStyles[Number(ca.s)]) value = excelSerialToIso(Number(v), date1904) ?? numberText(v);
              else value = numberText(v);
          }
          cells[col] = value;
        }
        for (let i = 0; i < cells.length; i++) cells[i] ??= "";
        if (cells.some((c) => c.trim() !== "")) rows.push({ line, cells });
      }
      return rows;
    },
  };
}
