/**
 * Validação e planejamento da importação (dry run no navegador).
 *
 * Regras que o backend deve manter (ver BACKEND_HANDOFF → Importação):
 * - linha com ERRO nunca é importada; nada é importado em silêncio;
 * - duplicata evidente (CPF/CNPJ ou CNJ já cadastrado) exige decisão explícita;
 * - uma linha pode gerar cliente, processo e o vínculo entre eles;
 * - o mesmo cliente em várias linhas vira UM cliente com vários processos.
 */
import { onlyDigits } from "@/lib/formatting";
import type { ImportConflictAction, ImportIssueSeverity, ProcessStatus } from "@/lib/constants/status";
import { isCnjFormat, isCnpjFormat, isCpfFormat, parseCurrencyInput } from "@/lib/validation";
import type { ImportPlan, ImportProcessOperation, NewClientInput } from "@/store/types";
import type { Client, ID, Process, User } from "@/types";
import { FIELD_BY_KEY, normalizeHeader, type ImportFieldKey } from "./fields";

export interface ImportIssue {
  severity: ImportIssueSeverity;
  message: string;
}

export type ImportConflictKind = "CLIENT_DOCUMENT" | "PROCESS_CNJ";

export interface ImportConflict {
  id: string;
  kind: ImportConflictKind;
  /** Linha da planilha (numeração do arquivo, cabeçalho = 1). */
  line: number;
  label: string;
  existingId: ID;
  existingLabel: string;
  allowed: ImportConflictAction[];
  /** Ações exibidas mas bloqueadas, com o motivo. */
  blocked: Partial<Record<ImportConflictAction, string>>;
}

export type RowStatus = "OK" | "WARNING" | "ERROR";

export interface AnalyzedRow {
  line: number;
  values: Partial<Record<ImportFieldKey, string>>;
  clientRef?: string;
  clientName?: string;
  hasClient: boolean;
  hasProcess: boolean;
  issues: ImportIssue[];
  conflicts: ImportConflict[];
  status: RowStatus;
}

export interface ImportAnalysis {
  rows: AnalyzedRow[];
  conflicts: ImportConflict[];
  counts: { total: number; ok: number; warning: number; error: number };
  content: { clients: number; processes: number; links: number; finance: boolean };
}

export interface AnalysisContext {
  clients: Client[];
  processes: Process[];
  users: User[];
}

/* ------------------------------------------------------------------ */
/* Conversões                                                          */
/* ------------------------------------------------------------------ */

/** "31/12/2026" ou "2026-12-31" → "2026-12-31". */
export function parseDateValue(value: string): string | undefined {
  const v = value.trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return v;
  const br = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!br) return undefined;
  const [, d, m, y] = br;
  return `${y}-${m?.padStart(2, "0")}-${d?.padStart(2, "0")}`;
}

const STATUS_WORDS: [RegExp, ProcessStatus][] = [
  [/andamento|ativo/, "ACTIVE"],
  [/distribu/, "FILED"],
  [/suspens/, "SUSPENDED"],
  [/encerr|arquiv|baixad/, "CLOSED"],
  [/prepar/, "PREPARING"],
  [/pre.?ajuiz/, "PRE_FILING"],
];

function parseStatus(value: string | undefined): ProcessStatus | undefined {
  if (!value) return undefined;
  const v = normalizeHeader(value);
  return STATUS_WORDS.find(([re]) => re.test(v))?.[1];
}

function matchUser(value: string | undefined, users: User[]): User | undefined {
  if (!value?.trim()) return undefined;
  const v = normalizeHeader(value.replace(/^(dra?\.?)\s+/i, ""));
  return users.find((u) => {
    const names = [u.name, u.displayName.replace(/^(dra?\.?)\s+/i, "")].map(normalizeHeader);
    return names.some((n) => n === v || n.split(" ")[0] === v || n.startsWith(`${v} `));
  });
}

function existingClientName(c: Client): string {
  return c.kind === "INDIVIDUAL" ? c.fullName : (c.tradeName ?? c.legalName);
}

/* ------------------------------------------------------------------ */
/* Análise                                                             */
/* ------------------------------------------------------------------ */

export function analyzeImport(headers: string[], rows: string[][], mapping: Record<string, ImportFieldKey | "">, ctx: AnalysisContext): ImportAnalysis {
  const columns = headers.map((h, i) => ({ index: i, field: mapping[h] })).filter((c): c is { index: number; field: ImportFieldKey } => Boolean(c.field));
  const docIndex = new Map(ctx.clients.map((c) => [onlyDigits(c.kind === "INDIVIDUAL" ? c.cpf : c.cnpj), c]));
  const cnjIndex = new Map(ctx.processes.filter((p) => p.cnj).map((p) => [onlyDigits(p.cnj ?? ""), p]));
  const seenCnj = new Map<string, number>();
  const seenClientConflict = new Set<string>();
  const clientRefs = new Set<string>();
  let processCount = 0;
  let links = 0;
  let finance = false;

  const analyzed = rows.map((raw, i): AnalyzedRow => {
    const line = i + 2;
    const values: Partial<Record<ImportFieldKey, string>> = {};
    for (const c of columns) {
      const v = (raw[c.index] ?? "").trim();
      if (v) values[c.field] = v;
    }
    const issues: ImportIssue[] = [];
    const conflicts: ImportConflict[] = [];
    const hasClient = Object.keys(values).some((k) => FIELD_BY_KEY.get(k as ImportFieldKey)?.entity === "client");
    const hasProcess = Object.keys(values).some((k) => FIELD_BY_KEY.get(k as ImportFieldKey)?.entity === "process");

    // Cliente
    let clientRef: string | undefined;
    const name = values["client.name"];
    if (hasClient) {
      const docDigits = onlyDigits(values["client.document"] ?? "");
      const declaredPj = /pj|jur/i.test(values["client.kind"] ?? "");
      const isCompany = declaredPj || docDigits.length === 14;
      if (!name) issues.push({ severity: "ERROR", message: "Cliente sem nome." });
      if (values["client.document"]) {
        const valid = isCompany ? isCnpjFormat(docDigits) : isCpfFormat(docDigits);
        if (!valid) issues.push({ severity: "ERROR", message: isCompany ? "CNPJ inválido." : "CPF inválido." });
        else clientRef = `doc:${docDigits}`;
      } else {
        issues.push({ severity: "WARNING", message: "Cliente sem CPF/CNPJ: não é possível detectar se já está cadastrado." });
      }
      if (!clientRef && name) clientRef = `name:${normalizeHeader(name)}`;
      if (values["client.email"] && !/^\S+@\S+\.\S+$/.test(values["client.email"])) issues.push({ severity: "WARNING", message: "E-mail em formato inválido: será ignorado." });
      const existing = clientRef?.startsWith("doc:") ? docIndex.get(docDigits) : undefined;
      if (existing && clientRef && !seenClientConflict.has(clientRef)) {
        seenClientConflict.add(clientRef);
        conflicts.push({
          id: `client:${clientRef}`,
          kind: "CLIENT_DOCUMENT",
          line,
          label: `${isCompany ? "CNPJ" : "CPF"} já cadastrado`,
          existingId: existing.id,
          existingLabel: existingClientName(existing),
          allowed: ["UPDATE", "IGNORE"],
          blocked: { CREATE_NEW: `Não permitido: ${isCompany ? "CNPJ" : "CPF"} idêntico criaria uma duplicata.` },
        });
      }
    }

    // Processo
    if (hasProcess) {
      const cnj = values["process.cnj"];
      if (cnj) {
        const digits = onlyDigits(cnj);
        if (!isCnjFormat(digits)) issues.push({ severity: "ERROR", message: "Número CNJ inválido (precisa ter 20 dígitos)." });
        else if (seenCnj.has(digits)) issues.push({ severity: "ERROR", message: `Processo duplicado no arquivo (mesmo CNJ da linha ${seenCnj.get(digits)}).` });
        else {
          seenCnj.set(digits, line);
          const existing = cnjIndex.get(digits);
          if (existing) {
            conflicts.push({
              id: `process:${line}`,
              kind: "PROCESS_CNJ",
              line,
              label: "Processo (CNJ) já cadastrado",
              existingId: existing.id,
              existingLabel: existing.title,
              allowed: ["UPDATE", "IGNORE"],
              blocked: { CREATE_NEW: "Não permitido: o número CNJ identifica um único processo." },
            });
          }
        }
      } else if (!values["process.title"] && !values["process.actionType"]) {
        issues.push({ severity: "ERROR", message: "Processo sem número CNJ, nome ou tipo de ação." });
      }
      if (!values["process.responsible"]) issues.push({ severity: "WARNING", message: "Processo sem responsável: será criado com alerta para definir." });
      else if (!matchUser(values["process.responsible"], ctx.users)) issues.push({ severity: "WARNING", message: `Responsável “${values["process.responsible"]}” não encontrado na equipe: ficará sem responsável.` });
      if (!values["process.dueDate"]) issues.push({ severity: "WARNING", message: "Sem data de vencimento: nenhum prazo será criado." });
      else if (!parseDateValue(values["process.dueDate"])) issues.push({ severity: "WARNING", message: "Data de vencimento inválida: será ignorada." });
      if (!hasClient) issues.push({ severity: "WARNING", message: "Processo sem cliente: ficará com vínculo pendente." });
    }
    if (values["finance.fee"]) {
      finance = true;
      issues.push({ severity: "WARNING", message: "Informação financeira identificada: fica como referência; contratos de honorários não são importados nesta etapa." });
    }
    if (!hasClient && !hasProcess && !values["finance.fee"]) issues.push({ severity: "ERROR", message: "Linha sem dados mapeados." });

    const status: RowStatus = issues.some((x) => x.severity === "ERROR") ? "ERROR" : issues.length || conflicts.length ? "WARNING" : "OK";
    if (status !== "ERROR") {
      if (hasClient && clientRef) clientRefs.add(clientRef);
      if (hasProcess) {
        processCount += 1;
        if (hasClient) links += 1;
      }
    }
    return { line, values, clientRef, clientName: name, hasClient, hasProcess, issues, conflicts: status === "ERROR" ? [] : conflicts, status };
  });

  return {
    rows: analyzed,
    conflicts: analyzed.flatMap((r) => r.conflicts),
    counts: {
      total: analyzed.length,
      ok: analyzed.filter((r) => r.status === "OK").length,
      warning: analyzed.filter((r) => r.status === "WARNING").length,
      error: analyzed.filter((r) => r.status === "ERROR").length,
    },
    content: { clients: clientRefs.size, processes: processCount, links, finance },
  };
}

/* ------------------------------------------------------------------ */
/* Plano                                                               */
/* ------------------------------------------------------------------ */

export type ConflictResolutions = Record<string, ImportConflictAction | undefined>;

export function unresolvedConflicts(analysis: ImportAnalysis, resolutions: ConflictResolutions): ImportConflict[] {
  return analysis.conflicts.filter((c) => !resolutions[c.id]);
}

function clientInput(row: AnalyzedRow, responsibleUserId: ID): NewClientInput {
  const v = row.values;
  const doc = onlyDigits(v["client.document"] ?? "");
  const isCompany = /pj|jur/i.test(v["client.kind"] ?? "") || doc.length === 14;
  const contact = { email: v["client.email"] && /^\S+@\S+\.\S+$/.test(v["client.email"]) ? v["client.email"] : undefined, phone: v["client.phone"] };
  const address =
    v["client.city"] || v["client.street"]
      ? {
          zipCode: v["client.zipCode"] ?? "",
          street: v["client.street"] ?? "",
          number: v["client.number"] ?? "",
          district: v["client.district"] ?? "",
          city: v["client.city"] ?? "",
          state: v["client.state"] ?? "",
          country: "Brasil",
        }
      : undefined;
  const base = { status: "ACTIVE" as const, responsibleUserId, contact, address, notes: "Importado por planilha." };
  return isCompany
    ? { ...base, kind: "COMPANY", legalName: v["client.name"] ?? "", cnpj: doc, representatives: [], partners: [] }
    : { ...base, kind: "INDIVIDUAL", fullName: v["client.name"] ?? "", cpf: doc };
}

function processInput(row: AnalyzedRow, users: User[]): { input: ProcessCreateInput; missingResponsible: boolean } {
  const v = row.values;
  const cnj = v["process.cnj"] ? onlyDigits(v["process.cnj"]) : undefined;
  const responsible = matchUser(v["process.responsible"], users);
  const status = parseStatus(v["process.status"]) ?? (cnj ? "ACTIVE" : "PRE_FILING");
  const dueDate = v["process.dueDate"] ? parseDateValue(v["process.dueDate"]) : undefined;
  const actionType = v["process.actionType"] ?? "A definir";
  return {
    missingResponsible: !responsible,
    input: {
      cnj: v["process.cnj"],
      title: v["process.title"] ?? v["process.actionType"] ?? `Processo ${v["process.cnj"] ?? "importado"}`,
      court: v["process.court"],
      area: "CIVIL",
      actionType,
      clientPole: "ACTIVE",
      opposingParty: v["process.opposingParty"],
      responsibleUserId: responsible?.id ?? "",
      distributionDate: v["process.distributionDate"] ? parseDateValue(v["process.distributionDate"]) : undefined,
      caseValue: parseCurrencyInput(v["process.caseValue"]),
      status,
      phase: status === "PRE_FILING" ? "PRELIMINARY" : status === "CLOSED" ? "ARCHIVED" : "PLEADINGS",
      nextDeadline: dueDate ? { title: "Vencimento importado da planilha", type: "INTERNAL", dueDate } : undefined,
    },
  };
}

type ProcessCreateInput = Extract<ImportProcessOperation, { action: "CREATE" }>["input"];
type ProcessUpdatePatch = Extract<ImportProcessOperation, { action: "UPDATE" }>["patch"];

/** Para UPDATE: só os campos presentes na planilha. Padrões de criação não sobrescrevem o processo existente. */
function updatePatch(row: AnalyzedRow, input: ProcessCreateInput): ProcessUpdatePatch {
  const v = row.values;
  const patch: ProcessUpdatePatch = {
    cnj: input.cnj,
    court: input.court,
    opposingParty: input.opposingParty,
    distributionDate: input.distributionDate,
    caseValue: input.caseValue,
  };
  if (v["process.title"]) patch.title = v["process.title"];
  if (v["process.actionType"]) patch.actionType = v["process.actionType"];
  if (input.responsibleUserId) patch.responsibleUserId = input.responsibleUserId;
  if (parseStatus(v["process.status"])) {
    patch.status = input.status;
    patch.phase = input.phase;
  }
  return patch;
}

/** Monta o plano final. Retorna null enquanto houver conflito sem decisão. */
export function buildImportPlan(
  fileName: string,
  analysis: ImportAnalysis,
  resolutions: ConflictResolutions,
  ctx: { users: User[]; defaultResponsibleId: ID },
): ImportPlan | null {
  if (unresolvedConflicts(analysis, resolutions).length > 0) return null;
  const clientOps = new Map<string, ImportPlan["clients"][number]>();
  const keptExisting = new Map<string, ID>();
  const processes: ImportProcessOperation[] = [];
  let ignoredRows = 0;

  for (const row of analysis.rows) {
    if (row.status === "ERROR") continue;
    let contributed = false;
    const clientConflict = row.clientRef ? analysis.conflicts.find((c) => c.id === `client:${row.clientRef}`) : undefined;

    if (row.hasClient && row.clientRef && !clientOps.has(row.clientRef) && !keptExisting.has(row.clientRef)) {
      const action = clientConflict ? resolutions[clientConflict.id] : undefined;
      if (clientConflict && action === "IGNORE") {
        // Mantém o cadastro atual como está; processos da linha vinculam a ele.
        keptExisting.set(row.clientRef, clientConflict.existingId);
      } else {
        const responsible = matchUser(row.values["process.responsible"], ctx.users);
        clientOps.set(row.clientRef, {
          ref: row.clientRef,
          action: clientConflict ? "UPDATE" : "CREATE",
          existingId: clientConflict?.existingId,
          input: clientInput(row, responsible?.id ?? ctx.defaultResponsibleId),
        });
        contributed = true;
      }
    } else if (row.hasClient && row.clientRef && clientOps.has(row.clientRef)) {
      contributed = true;
    }

    if (row.hasProcess) {
      const conflict = row.conflicts.find((c) => c.kind === "PROCESS_CNJ");
      const action = conflict ? resolutions[conflict.id] : undefined;
      if (!(conflict && action === "IGNORE")) {
        const { input, missingResponsible } = processInput(row, ctx.users);
        const link = {
          clientRef: row.clientRef && clientOps.has(row.clientRef) ? row.clientRef : undefined,
          clientId: row.clientRef ? keptExisting.get(row.clientRef) : undefined,
        };
        processes.push(
          conflict
            ? { ...link, action: "UPDATE", existingId: conflict.existingId, patch: updatePatch(row, input) }
            : { ...link, action: "CREATE", input, missingResponsible },
        );
        contributed = true;
      }
    }
    if (!contributed) ignoredRows += 1;
  }

  return { fileName, clients: [...clientOps.values()], processes, ignoredRows, errorRows: analysis.counts.error };
}
