import { mapsProcess, normalizeHeader, type ImportFieldKey } from "@/lib/domain/import-fields";
import type { ProcessPhase, ProcessStatus } from "@/lib/constants/status";
import type { RawRow } from "./parse";

/**
 * Validação e normalização de cada linha na SIMULAÇÃO (nada é gravado aqui).
 *
 * Saída por linha: VALID, WARNING (importável, com ressalva) ou ERROR (nunca
 * gravada), as mensagens, a linha original e o `payload` normalizado que o
 * banco grava depois da confirmação. O confronto com o que JÁ EXISTE no DG
 * Brasil (CPF/CNPJ, CNJ, nome igual) é do banco (import_finish_dry_run, 042).
 *
 * Regras de formato iguais às do resto do sistema: CPF/CNPJ por quantidade de
 * dígitos (o dígito verificador errado só gera aviso, como no cadastro); CNJ
 * com dígito verificador (o banco recusa CNJ inválido).
 */

export type RowStatus = "VALID" | "WARNING" | "ERROR";

export interface ImportUser {
  id: string;
  name: string;
  preferredName?: string | null;
  role: string;
}

export interface NormalizeContext {
  users: ImportUser[];
  /** Advogado padrão (opções do mapeamento): responsável do cliente novo quando a linha não diz. */
  lawyerId?: string;
  /** Hoje no fuso do escritório, AAAA-MM-DD (prazo no passado não vira prazo). */
  today: string;
}

export interface ClientPayload {
  /** Ausentes em `by_name`: o banco acha o cliente já cadastrado pelo nome e preenche. */
  kind?: "INDIVIDUAL" | "COMPANY";
  document?: string;
  name: string;
  /** Linha de processo sem CPF/CNPJ: ligar ao cliente JÁ cadastrado com este nome (042). */
  by_name?: true;
  email?: string;
  phone?: string;
  address?: { postal_code?: string; street?: string; number?: string; complement?: string; neighborhood?: string; city?: string; state?: string };
  notes?: string;
}

export interface ProcessPayload {
  cnj?: string;
  title?: string;
  legal_class?: string;
  subject?: string;
  court?: string;
  court_unit?: string;
  district?: string;
  state?: string;
  adverse_party?: string;
  client_side?: "ACTIVE" | "PASSIVE" | "THIRD_PARTY";
  responsible_user_id?: string;
  status?: ProcessStatusCode;
  phase?: ProcessPhase;
  distribution_date?: string;
  case_value?: number;
  due_date?: string;
  notes?: string;
}

export interface StagedRow {
  row_number: number;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  raw_data: Record<string, string>;
  payload?: { client: ClientPayload; process?: ProcessPayload };
}

/** Status do processo (vocabulário do banco, migration 045). */
export type ProcessStatusCode = ProcessStatus;

/* ------------------------------------------------------------------ */
/* Conversões                                                          */
/* ------------------------------------------------------------------ */

export const onlyDigits = (v: string) => v.replace(/\D/g, "");
const allSame = (d: string) => /^(\d)\1+$/.test(d);

function cpfCheck(d: string): boolean {
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function cnpjCheck(d: string): boolean {
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** CNJ (Res. 65/2008): NNNNNNN DD AAAA J TR OOOO com DV módulo 97 — a mesma conta do banco. */
export function isValidCnj(d: string): boolean {
  if (!/^\d{20}$/.test(d)) return false;
  const base = BigInt(`${d.slice(0, 7)}${d.slice(9, 20)}00`);
  return 98n - (base % 97n) === BigInt(d.slice(7, 9));
}

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const UF_NAMES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES",
  goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB",
  parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

export function parseUf(value: string): string | undefined {
  const up = value.trim().toUpperCase();
  if ((UFS as readonly string[]).includes(up)) return up;
  return UF_NAMES[normalizeHeader(value)];
}

/** "31/12/2026", "31/12/26", "31-12-2026", "2026-12-31" (ou ISO com hora) → "2026-12-31". */
export function parseDate(value: string): string | undefined {
  const v = value.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) {
    [d, m, y] = [Number(br[1]), Number(br[2]), Number(br[3])];
    if (br[3]!.length === 2) y += y >= 70 ? 1900 : 2000;
  } else return undefined;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "R$ 1.234,56", "1234,56", "1234.56" (número do Excel), "1.234.567" → número. */
export function parseMoney(value: string): number | undefined {
  let v = value.replace(/[R$\s]/gi, "").replace(/ /g, "");
  if (!v) return undefined;
  const negative = /^-|^\(.*\)$/.test(v);
  v = v.replace(/[()-]/g, "");
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if ((v.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(v)) v = v.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return undefined;
  const n = Math.round(Number(v) * 100) / 100;
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/**
 * Texto da planilha → status. A primeira regra que casa vence; entre etapas,
 * a mais adiantada vem antes ("cumprimento de sentença" é execução, não
 * sentença; "sentença transitada" é trânsito em julgado). Textos dos status
 * antigos continuam reconhecidos: "aguardando cliente/prazo" → Em andamento;
 * encerrado/baixado/extinto → Arquivado.
 */
const STATUS_WORDS: [RegExp, ProcessStatusCode][] = [
  [/^pre ?ajuiz|^pre filing/, "PRE_FILING"],
  [/prepar|a ajuizar|^preparing/, "PREPARING"],
  [/aguardando (cliente|prazo|sentenc)|concluso|^waiting (client|deadline)/, "ACTIVE"],
  [/suspens|sobrest|^suspended/, "SUSPENDED"],
  [/arquiv|encerr|finaliz|conclui|baixad|extint|^archived|^closed/, "ARCHIVED"],
  [/recebid|^received/, "RECEIVED"],
  [/execu|cumprimento|^enforcement/, "ENFORCEMENT"],
  [/transit|^final judgment/, "FINAL_JUDGMENT"],
  [/recurs|apela|agravo|^appeal/, "APPEAL"],
  [/sentenc/, "SENTENCED"],
  [/distribu|ajuizad|protocolad|^filed/, "FILED"],
  [/andamento|ativo|tramit|^active|em curso/, "ACTIVE"],
];

export function parseStatus(value: string): ProcessStatusCode | undefined {
  const v = normalizeHeader(value).replace(/_/g, " ");
  return STATUS_WORDS.find(([re]) => re.test(v))?.[1];
}

/**
 * Fase que o status deixa clara. Em andamento, recebido e suspenso não dizem
 * a fase: fica a que o processo já tem (ou nenhuma, no processo novo).
 */
const PHASE_OF_STATUS: Partial<Record<ProcessStatusCode, ProcessPhase>> = {
  PRE_FILING: "PRELIMINARY",
  PREPARING: "PRELIMINARY",
  FILED: "PROCEEDINGS",
  SENTENCED: "PROCEEDINGS",
  APPEAL: "APPEAL",
  FINAL_JUDGMENT: "FINAL_JUDGMENT",
  ENFORCEMENT: "ENFORCEMENT",
  ARCHIVED: "ARCHIVED",
};

export function parseClientSide(value: string): ProcessPayload["client_side"] | undefined {
  const v = normalizeHeader(value);
  if (/^(autor|ativo|polo ativo|requerente|reclamante|exequente|active|a)$/.test(v) || /autor|ativo|requerente/.test(v)) return "ACTIVE";
  if (/^(reu|re|passivo|polo passivo|requerido|reclamado|executado|passive|p)$/.test(v) || /reu|passivo|requerid/.test(v)) return "PASSIVE";
  if (/terceir|interessad|third/.test(v)) return "THIRD_PARTY";
  return undefined;
}

const stripTitle = (v: string) => normalizeHeader(v.replace(/^(dr|dra|dr\.|dra\.)\s+/i, ""));

/** Casa "Responsável" com a equipe: nome completo, nome de preferência ou primeiro nome (se único). */
export function matchUser(value: string, users: ImportUser[]): { user?: ImportUser; ambiguous: boolean } {
  const v = stripTitle(value);
  if (!v) return { ambiguous: false };
  const exact = users.filter((u) => [u.name, u.preferredName ?? ""].some((n) => n && stripTitle(n) === v));
  if (exact.length === 1) return { user: exact[0], ambiguous: false };
  if (exact.length > 1) return { ambiguous: true };
  const partial = users.filter((u) => [u.name, u.preferredName ?? ""].some((n) => {
    const s = stripTitle(n);
    return s && (s.split(" ")[0] === v || s.startsWith(`${v} `));
  }));
  if (partial.length === 1) return { user: partial[0], ambiguous: false };
  return { ambiguous: partial.length > 1 };
}

const clip = (v: string | undefined, max: number) => (v ? v.slice(0, max) : undefined);

/* ------------------------------------------------------------------ */
/* Linha a linha                                                        */
/* ------------------------------------------------------------------ */

export function normalizeRows(
  headers: string[],
  rows: RawRow[],
  mapping: Partial<Record<ImportFieldKey, string>>,
  ctx: NormalizeContext,
): StagedRow[] {
  const index = new Map(headers.map((h, i) => [h, i]));
  const col = Object.entries(mapping)
    .map(([field, header]) => [field as ImportFieldKey, header ? index.get(header) : undefined] as const)
    .filter((x): x is readonly [ImportFieldKey, number] => x[1] !== undefined);
  const hasProcessColumns = mapsProcess(col.map(([f]) => f));
  const seenCnj = new Map<string, number>();
  const firstClient = new Map<string, { line: number; name: string; kind: string }>();

  return rows.map((row): StagedRow => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (row.cells[i]) raw[h] = row.cells[i]!.slice(0, 1000);
    });
    const v: Partial<Record<ImportFieldKey, string>> = {};
    for (const [field, i] of col) {
      const value = (row.cells[i] ?? "").trim();
      if (value && !/^[-–—]$/.test(value)) v[field] = value;
    }

    // ── responsável (cliente novo e processo) ──
    let responsibleId: string | undefined;
    if (v["process.responsible"]) {
      const m = matchUser(v["process.responsible"], ctx.users);
      if (m.user) responsibleId = m.user.id;
      else if (m.ambiguous) warnings.push(`Responsável “${v["process.responsible"]}” corresponde a mais de uma pessoa da equipe: escreva o nome completo. Fica o advogado padrão.`);
      else warnings.push(`Responsável “${v["process.responsible"]}” não encontrado na equipe: fica o advogado padrão.`);
    }

    // ── cliente ──
    const name = clip(v["client.name"]?.replace(/\s+/g, " "), 300);
    if (!name) errors.push("Nome do cliente vazio.");
    let document: string | undefined;
    let kind: ClientPayload["kind"] | undefined;
    const hasProcess = hasProcessColumns && col.some(([f]) => f.startsWith("process.") && f !== "process.responsible" && v[f]);
    const rawDoc = v["client.document"];
    // Sem CPF/CNPJ: só processo de cliente já cadastrado (o banco acha pelo nome).
    const byName = !rawDoc && hasProcess;
    if (!rawDoc) {
      if (!hasProcess) errors.push("CPF/CNPJ do cliente vazio: cliente novo precisa do documento.");
    } else {
      let d = onlyDigits(rawDoc);
      // O Excel tira o zero da frente de CPF/CNPJ guardado como número.
      if (/^\d+$/.test(rawDoc.trim()) && (d.length === 9 || d.length === 10)) {
        d = d.padStart(11, "0");
        warnings.push("CPF completado com zero à esquerda (o Excel remove zeros de números). Confira.");
      } else if (/^\d+$/.test(rawDoc.trim()) && (d.length === 12 || d.length === 13)) {
        d = d.padStart(14, "0");
        warnings.push("CNPJ completado com zero à esquerda (o Excel remove zeros de números). Confira.");
      }
      if (d.length !== 11 && d.length !== 14) errors.push(`CPF/CNPJ com ${d.length} dígitos: precisa ter 11 (CPF) ou 14 (CNPJ).`);
      else if (allSame(d)) errors.push(d.length === 11 ? "CPF inválido." : "CNPJ inválido.");
      else {
        document = d;
        kind = d.length === 11 ? "INDIVIDUAL" : "COMPANY";
        if (!(kind === "INDIVIDUAL" ? cpfCheck(d) : cnpjCheck(d))) warnings.push(`Dígito verificador do ${kind === "INDIVIDUAL" ? "CPF" : "CNPJ"} não confere: confira o número.`);
      }
    }
    if (kind && v["client.kind"]) {
      const k = normalizeHeader(v["client.kind"]);
      const declared = /^(pj|j|juridica|pessoa juridica|empresa|company)$/.test(k) ? "COMPANY" : /^(pf|f|fisica|pessoa fisica|individual)$/.test(k) ? "INDIVIDUAL" : undefined;
      if (declared && declared !== kind) errors.push(`Tipo de pessoa “${v["client.kind"]}” não combina com o documento (${kind === "INDIVIDUAL" ? "CPF" : "CNPJ"}).`);
    }

    let email: string | undefined;
    if (v["client.email"]) {
      const e = v["client.email"].toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200) email = e;
      else warnings.push(`E-mail “${v["client.email"]}” em formato inválido: não será importado.`);
    }
    let phone: string | undefined;
    if (v["client.phone"]) {
      let p = onlyDigits(v["client.phone"]);
      if ((p.length === 12 || p.length === 13) && p.startsWith("55")) p = p.slice(2);
      if (p.length === 10 || p.length === 11) phone = p;
      else warnings.push(`Telefone “${v["client.phone"]}” sem DDD ou incompleto: não será importado.`);
    }
    const address: NonNullable<ClientPayload["address"]> = {};
    if (v["client.zipCode"]) {
      let z = onlyDigits(v["client.zipCode"]);
      if (z.length === 7 && /^\d+$/.test(v["client.zipCode"].trim())) z = `0${z}`;
      if (z.length === 8) address.postal_code = z;
      else warnings.push(`CEP “${v["client.zipCode"]}” inválido: não será importado.`);
    }
    if (v["client.street"]) address.street = clip(v["client.street"], 200);
    if (v["client.number"]) address.number = clip(v["client.number"], 30);
    if (v["client.complement"]) address.complement = clip(v["client.complement"], 120);
    if (v["client.district"]) address.neighborhood = clip(v["client.district"], 120);
    if (v["client.city"]) address.city = clip(v["client.city"], 120);
    if (v["client.state"]) {
      const uf = parseUf(v["client.state"]);
      if (uf) address.state = uf;
      else warnings.push(`UF “${v["client.state"]}” não reconhecida: não será importada.`);
    }

    // ── processo ──
    let process: ProcessPayload | undefined;
    if (hasProcess) {
      process = {};
      if (v["process.cnj"]) {
        const d = onlyDigits(v["process.cnj"]);
        if (d.length !== 20) errors.push(`Número CNJ “${v["process.cnj"]}” precisa ter 20 dígitos.`);
        else if (!isValidCnj(d)) errors.push(`Número CNJ “${v["process.cnj"]}” inválido: o dígito verificador não confere.`);
        else if (seenCnj.has(d)) errors.push(`Processo repetido no arquivo: o mesmo CNJ está na linha ${seenCnj.get(d)}.`);
        else {
          seenCnj.set(d, row.line);
          process.cnj = d;
        }
      } else if (!v["process.title"] && !v["process.actionType"]) {
        errors.push("Processo sem número CNJ, nome ou tipo de ação: não dá para identificá-lo.");
      }
      process.title = clip(v["process.title"], 300);
      process.legal_class = clip(v["process.actionType"], 300);
      process.subject = clip(v["process.subject"], 300);
      process.court = clip(v["process.court"], 200);
      process.court_unit = clip(v["process.courtUnit"], 200);
      process.district = clip(v["process.district"], 120);
      process.adverse_party = clip(v["process.opposingParty"], 300);
      process.notes = clip(v["process.notes"], 4000);
      if (v["process.state"]) {
        const uf = parseUf(v["process.state"]);
        if (uf) process.state = uf;
        else warnings.push(`UF do processo “${v["process.state"]}” não reconhecida: não será importada.`);
      }
      if (v["process.clientSide"]) {
        const side = parseClientSide(v["process.clientSide"]);
        if (side) process.client_side = side;
        else warnings.push(`Polo “${v["process.clientSide"]}” não reconhecido: o cliente fica como autor (polo ativo).`);
      }
      if (v["process.status"]) {
        const s = parseStatus(v["process.status"]);
        if (s) {
          process.status = s;
          process.phase = PHASE_OF_STATUS[s];
        } else warnings.push(`Status “${v["process.status"]}” não reconhecido: fica “Em andamento” (com CNJ) ou “Em preparação” (sem CNJ).`);
      }
      if (v["process.distributionDate"]) {
        const d = parseDate(v["process.distributionDate"]);
        if (d) process.distribution_date = d;
        else warnings.push(`Data de distribuição “${v["process.distributionDate"]}” inválida: não será importada.`);
      }
      if (v["process.caseValue"]) {
        const n = parseMoney(v["process.caseValue"]);
        if (n === undefined || n < 0 || n >= 1e12) warnings.push(`Valor da causa “${v["process.caseValue"]}” inválido: não será importado.`);
        else process.case_value = n;
      }
      if (v["process.dueDate"]) {
        const d = parseDate(v["process.dueDate"]);
        if (!d) warnings.push(`Vencimento “${v["process.dueDate"]}” inválido: nenhum prazo será criado.`);
        else if (d < ctx.today) warnings.push(`Vencimento ${d.split("-").reverse().join("/")} já passou: nenhum prazo será criado.`);
        else process.due_date = d;
      }
      if (responsibleId) process.responsible_user_id = responsibleId;
      for (const k of Object.keys(process) as (keyof ProcessPayload)[]) if (process[k] === undefined) delete process[k];
    }

    // Mesmo documento em várias linhas: vale a primeira linha SEM ERRO (a mesma regra do banco).
    if (!errors.length && document && name && kind) {
      const first = firstClient.get(document);
      if (!first) firstClient.set(document, { line: row.line, name, kind });
      else if (normalizeHeader(first.name) !== normalizeHeader(name)) {
        warnings.push(`O mesmo CPF/CNPJ aparece na linha ${first.line} com outro nome (“${first.name}”): vale o cadastro da linha ${first.line}.`);
      }
    }

    const status: RowStatus = errors.length ? "ERROR" : warnings.length ? "WARNING" : "VALID";
    const base = { row_number: row.line, status, errors, warnings, raw_data: raw };
    if (status === "ERROR" || !name) return base;
    if (byName) return { ...base, payload: { client: { name, by_name: true }, process: process ?? {} } };
    if (!document || !kind) return base;

    const client: ClientPayload = { kind, document, name };
    if (email) client.email = email;
    if (phone) client.phone = phone;
    if (Object.keys(address).length) client.address = address;
    if (v["client.notes"]) client.notes = clip(v["client.notes"], 4000);
    return { ...base, payload: process ? { client, process } : { client } };
  });
}
