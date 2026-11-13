/**
 * CSV que o Excel brasileiro abre direto: separador `;`, linhas CRLF, datas
 * dd/mm/aaaa, números com vírgula decimal. O BOM UTF-8 é posto no navegador
 * (`csvBlob`): o gerado no servidor se perde no caminho da Server Action.
 *
 * Puro e testado (exports.test.ts). Regras de segurança da planilha:
 *   - texto que começa com `=`, `+`, `-`, `@`, tabulação ou retorno ganha um
 *     apóstrofo na frente (o Excel não executa como fórmula);
 *   - número vai como número; identificador comprido (CPF, CNPJ, CNJ) deve ir
 *     COM máscara, senão o Excel o trata como número e corta zeros.
 */

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<R> {
  /** Título da coluna, em português. */
  header: string;
  /** Valor da célula. Use `csvDate`, `csvDateTime` e `csvMoney` para datas e valores. */
  value: (row: R) => CsvCell;
}

const TIME_ZONE = "America/Sao_Paulo";
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateParts = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric" });
const timeParts = new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** dd/mm/aaaa. Data sem hora (`aaaa-mm-dd`) não passa por fuso; instante usa o fuso de São Paulo. */
export function csvDate(value: string | Date | null | undefined): string {
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = toDate(value);
  return d ? dateParts.format(d) : "";
}

/** dd/mm/aaaa hh:mm, no fuso de São Paulo. */
export function csvDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? `${dateParts.format(d)} ${timeParts.format(d)}` : "";
}

/** Número com vírgula decimal e sem separador de milhar (o Excel reconhece como número). */
export function csvNumber(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  const text = decimals === undefined ? String(value) : value.toFixed(decimals);
  return text.replace(".", ",");
}

/** Valor em reais: duas casas, vírgula decimal, sem "R$". */
export const csvMoney = (value: number | null | undefined) => csvNumber(value, 2);

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[";\r\n]|^\s|\s$/;

function cellText(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return csvNumber(value);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const headerText = (value: string) => (NEEDS_QUOTES.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/** Monta o CSV (sem BOM). Uma linha de títulos e uma linha por registro. */
export function buildCsv<R>(columns: readonly CsvColumn<R>[], rows: readonly R[]): string {
  const lines = [columns.map((c) => headerText(c.header)).join(";")];
  for (const row of rows) lines.push(columns.map((c) => cellText(c.value(row))).join(";"));
  return `${lines.join("\r\n")}\r\n`;
}
