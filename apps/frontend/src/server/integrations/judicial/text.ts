import { createHash } from "node:crypto";

/**
 * Utilidades puras da integração judicial (043): texto do DJEN (que chega em
 * texto puro, com <br /> ou como documento HTML inteiro, conforme o tribunal),
 * número CNJ, índice do DataJud e datas.
 */

const NAMED: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ordm: "º", ordf: "ª", sect: "§", deg: "°",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â", atilde: "ã", Atilde: "Ã",
  eacute: "é", Eacute: "É", ecirc: "ê", Ecirc: "Ê", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó",
  ocirc: "ô", Ocirc: "Ô", otilde: "õ", Otilde: "Õ", uacute: "ú", Uacute: "Ú", uuml: "ü", Uuml: "Ü",
  ccedil: "ç", Ccedil: "Ç", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", bull: "•",
  // Espaços tipográficos (o DJEN usa &emsp; para recuo de parágrafo): viram espaço comum.
  emsp: " ", ensp: " ", thinsp: " ", emsp13: " ", emsp14: " ", numsp: " ", puncsp: " ", hairsp: " ",
  // Invisíveis: somem.
  zwnj: "", zwj: "", shy: "", lrm: "", rlm: "",
  egrave: "è", Egrave: "È", igrave: "ì", Igrave: "Ì", ograve: "ò", Ograve: "Ò", ugrave: "ù", Ugrave: "Ù",
  icirc: "î", Icirc: "Î", ucirc: "û", Ucirc: "Û", auml: "ä", Auml: "Ä", euml: "ë", Euml: "Ë", iuml: "ï", Iuml: "Ï",
  ouml: "ö", Ouml: "Ö", ntilde: "ñ", Ntilde: "Ñ", sbquo: "‚", bdquo: "„", dagger: "†", Dagger: "‡",
  minus: "−", times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾", sup1: "¹", sup2: "²", sup3: "³",
  para: "¶", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", cent: "¢", iexcl: "¡", iquest: "¿", micro: "µ",
  rarr: "→", larr: "←", prime: "′", Prime: "″", permil: "‰", acute: "´", cedil: "¸", uml: "¨", macr: "¯",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? m;
  });
}

/** HTML (ou texto) do DJEN → texto legível, sem marcação, com quebras de parágrafo. */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  s = s.replace(/<(head|style|script|title)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|article|section|table|blockquote)>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Invisíveis (largura zero, hífen opcional, marcas de direção, BOM) somem; espaço
  // tipográfico que veio como número (&#8195;) ou já em Unicode vira espaço comum.
  s = s.replace(/[­​-‏⁠﻿]/g, "").replace(/[  -   　]/g, " ");
  s = s.replace(/\r\n?/g, "\n").replace(/[ \t\f\v ]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Corrige a caixa estragada de alguns campos do DJEN ("AçãO PENAL" → "Ação penal"). */
export function fixCase(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  if (!/[a-zà-ÿ][A-ZÀ-Þ]/.test(s) && !(s === s.toUpperCase() && /[A-Z]{4}/.test(s))) return s;
  const low = s.toLocaleLowerCase("pt-BR");
  return low.charAt(0).toLocaleUpperCase("pt-BR") + low.slice(1);
}

export const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Número CNJ válido (20 dígitos, dígito verificador módulo 97). */
export function isValidCnj(cnj: string): boolean {
  if (!/^\d{20}$/.test(cnj)) return false;
  const n = cnj.slice(0, 7), dv = cnj.slice(7, 9), rest = cnj.slice(9);
  return 98n - (BigInt(n + rest + "00") % 97n) === BigInt(dv);
}

export function formatCnj(cnj: string): string {
  return /^\d{20}$/.test(cnj)
    ? `${cnj.slice(0, 7)}-${cnj.slice(7, 9)}.${cnj.slice(9, 13)}.${cnj.slice(13, 14)}.${cnj.slice(14, 16)}.${cnj.slice(16)}`
    : cnj;
}

// Ordem das UFs na Res. CNJ 65/2008 (segmento TR da Justiça Estadual e Eleitoral).
const UF_BY_TR = ["ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc", "se", "sp", "to"];

/**
 * Índice do DataJud (api_publica_<alias>) a partir do número CNJ: segmento J
 * (posição 14) e TR (15–16). Sem índice (STF, CNJ, conselhos): null.
 * Atenção: o TRE do DF é "tre-df" (a wiki do CNJ diz "tre-dft", que dá 404).
 */
export function datajudAlias(cnj: string): string | null {
  if (!/^\d{20}$/.test(cnj)) return null;
  const j = cnj[13];
  const tr = Number(cnj.slice(14, 16));
  const uf = UF_BY_TR[tr - 1];
  switch (j) {
    case "8":
      return uf ? (uf === "df" ? "tjdft" : `tj${uf}`) : null;
    case "6":
      return tr === 0 ? "tse" : uf ? `tre-${uf}` : null;
    case "4":
      return tr >= 1 && tr <= 6 ? `trf${tr}` : null;
    case "5":
      return tr === 0 ? "tst" : tr >= 1 && tr <= 24 ? `trt${tr}` : null;
    case "9":
      return ({ 13: "tjmmg", 21: "tjmrs", 26: "tjmsp" } as Record<number, string>)[tr] ?? null;
    case "3":
      return "stj";
    case "7":
      return "stm";
    default:
      return null;
  }
}

/** Sigla do tribunal para exibição e calendário ("tjsp" → "TJSP", "tre-sp" → "TRE-SP"). */
export const courtFromAlias = (alias: string) => alias.toUpperCase();

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** "AAAA-MM-DD" + n dias. */
export function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** dataAjuizamento do DataJud: "yyyyMMddHHmmss" (ou ISO) → "AAAA-MM-DD". */
export function parseDatajudDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{8}/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/** Mensagem curta e sem dado pessoal para gravar no banco. */
export function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, " ").slice(0, 300);
}
