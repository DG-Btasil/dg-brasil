import { z } from "zod";
import {
  CLIENT_POLE_LABEL,
  CLIENT_POLES,
  DEADLINE_TYPE_LABEL,
  DEADLINE_TYPES,
  DOCUMENT_CATEGORY_LABEL,
  LEGAL_CASE_STATUS_LABEL,
  PRIORITIES,
  PRIORITY_LABEL,
  type DeadlineType,
  type DocumentCategory,
  type LegalCaseStatus,
  type Priority,
} from "@/lib/constants/status";
import { formatCurrency, formatDateTimeAt } from "@/lib/formatting";
import { isCnjFormat, msg, readCurrencyInput, zCurrencyOptional, zRequired } from "@/lib/validation";
import type { CorrectableProposalType } from "@/server/domain/reviews/correction-rules";

/**
 * "Corrigir e aprovar" (069): formulários da correção de cada tipo de
 * proposta, preenchidos com o que o agente propôs, e a montagem dos dados
 * corrigidos no formato do contrato do agente (`PROPOSAL_DATA`). Puro e
 * testado (proposal-correction.test.ts).
 *
 * Regra da montagem: o ponto de partida é o que o agente propôs; um campo só
 * muda se a pessoa mudou o valor no formulário. Assim o resumo e a auditoria
 * mostram só o que foi corrigido de verdade.
 *
 * O prazo usa as regras do diálogo de prazo da equipe (`deadlineSchema`):
 * vencimento é a data civil, que vale até 23:59:59 em Brasília; audiência pede
 * a hora. Modalidade, local e link da audiência não fazem parte da proposta:
 * completam-se no prazo depois de aprovado.
 */

const OFFICE_TIME_ZONE = "America/Sao_Paulo";
/** Brasília sem horário de verão (mesma regra de `dueAtFromInput`, prazos). */
const OFFICE_UTC_OFFSET = "-03:00";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

type Data = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Data civil e hora (HH:MM) de um instante, no fuso do escritório. Texto que não é data: vazio. */
export function officeDateTimeParts(iso: unknown): { date: string; time: string } {
  if (typeof iso !== "string" || Number.isNaN(Date.parse(iso))) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** Data civil (e hora, na audiência) → instante com fuso. Sem hora = fim do dia em Brasília. */
export function officeInstant(date: string, time?: string): string {
  return `${date}T${time ? `${time}:00` : "23:59:59"}${OFFICE_UTC_OFFSET}`;
}

/* ------------------------------------------------------------------ */
/* Prazo (CREATE_DEADLINE)                                             */
/* ------------------------------------------------------------------ */

export const deadlineCorrectionSchema = z
  .object({
    title: zRequired("Informe o título do prazo.").min(3, "No mínimo 3 caracteres.").max(200, "Máximo de 200 caracteres."),
    type: z.enum(DEADLINE_TYPES, { error: () => ({ message: msg.required }) }),
    dueDate: z.string().refine((v) => ISO_DATE.test(v), "Informe o vencimento."),
    dueTime: z.string().optional(),
    responsibleUserId: zRequired("Selecione o responsável."),
    priority: z.enum(PRIORITIES, { error: () => ({ message: msg.required }) }),
    notes: z.string().max(4000, "Máximo de 4000 caracteres.").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "HEARING" && !HOUR.test(v.dueTime ?? "")) ctx.addIssue({ code: "custom", path: ["dueTime"], message: "Informe a hora da audiência." });
  });
export type DeadlineCorrectionInput = z.input<typeof deadlineCorrectionSchema>;
export type DeadlineCorrectionValues = z.output<typeof deadlineCorrectionSchema>;

export function deadlineCorrectionDefaults(data: Data): DeadlineCorrectionInput {
  const type = (DEADLINE_TYPES as readonly string[]).includes(text(data.deadline_type)) ? (data.deadline_type as DeadlineType) : "INTERNAL";
  const { date, time } = officeDateTimeParts(data.due_at);
  return {
    title: text(data.title),
    type,
    dueDate: date,
    dueTime: type === "HEARING" ? time : "",
    responsibleUserId: text(data.responsible_user_id),
    priority: (PRIORITIES as readonly string[]).includes(text(data.priority)) ? (data.priority as Priority) : "NORMAL",
    notes: text(data.description),
  };
}

/** Coloca `value` em `key` (ou tira a chave, quando vazio) só se a pessoa mudou o campo. */
function put(out: Data, key: string, changed: boolean, value: unknown) {
  if (!changed) return;
  if (value === undefined || value === null || value === "") delete out[key];
  else out[key] = value;
}

export function deadlineCorrectionData(original: Data, values: DeadlineCorrectionValues): Data {
  const before = deadlineCorrectionDefaults(original);
  const out: Data = { ...original };
  const hearing = values.type === "HEARING";
  put(out, "title", values.title.trim() !== before.title.trim(), values.title.trim());
  put(out, "deadline_type", values.type !== before.type, values.type);
  // A data (e a hora, na audiência) só é regravada quando mudou, ou quando o tipo mudou a regra da hora.
  const dueChanged = values.dueDate !== before.dueDate || (hearing && (values.dueTime ?? "") !== (before.dueTime ?? "")) || hearing !== (before.type === "HEARING");
  put(out, "due_at", dueChanged, officeInstant(values.dueDate, hearing ? values.dueTime : undefined));
  put(out, "responsible_user_id", values.responsibleUserId !== before.responsibleUserId, values.responsibleUserId);
  put(out, "priority", values.priority !== before.priority, values.priority);
  put(out, "description", (values.notes ?? "").trim() !== (before.notes ?? "").trim(), (values.notes ?? "").trim());
  return out;
}

/* ------------------------------------------------------------------ */
/* Pedido de documento (REQUEST_DOCUMENT)                              */
/* ------------------------------------------------------------------ */

export const documentCorrectionSchema = z.object({
  label: zRequired("Informe o documento pedido.").min(3, "No mínimo 3 caracteres.").max(200, "Máximo de 200 caracteres."),
  category: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "Selecione a categoria."),
  required: z.enum(["yes", "no"]),
  messageToPartner: z.string().max(2000, "Máximo de 2000 caracteres.").optional(),
  dueDate: z.string().optional().refine((v) => !v || ISO_DATE.test(v), msg.date),
});
export type DocumentCorrectionInput = z.input<typeof documentCorrectionSchema>;
export type DocumentCorrectionValues = z.output<typeof documentCorrectionSchema>;

export function documentCorrectionDefaults(data: Data): DocumentCorrectionInput {
  return {
    label: text(data.label),
    category: text(data.category) || "OTHER",
    required: data.required === false ? "no" : "yes",
    messageToPartner: text(data.message_to_partner),
    dueDate: officeDateTimeParts(data.due_at).date,
  };
}

export function documentCorrectionData(original: Data, values: DocumentCorrectionValues): Data {
  const before = documentCorrectionDefaults(original);
  const out: Data = { ...original };
  put(out, "label", values.label.trim() !== before.label.trim(), values.label.trim());
  put(out, "category", values.category !== before.category, values.category);
  put(out, "required", values.required !== before.required, values.required === "yes");
  put(out, "message_to_partner", (values.messageToPartner ?? "").trim() !== (before.messageToPartner ?? "").trim(), (values.messageToPartner ?? "").trim());
  put(out, "due_at", (values.dueDate ?? "") !== (before.dueDate ?? ""), values.dueDate ? officeInstant(values.dueDate) : "");
  return out;
}

/* ------------------------------------------------------------------ */
/* Atualização do caso (UPDATE_CASE)                                   */
/* ------------------------------------------------------------------ */

/** Situações em que o agente pode pôr o caso (contrato do agente e aplicador). */
export const AGENT_CASE_STATUSES = ["WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"] as const satisfies readonly LegalCaseStatus[];

export const caseCorrectionSchema = z
  .object({
    title: z.string().max(200, "Máximo de 200 caracteres.").optional().refine((v) => !v?.trim() || v.trim().length >= 3, "No mínimo 3 caracteres."),
    summary: z.string().max(8000, "Máximo de 8000 caracteres.").optional(),
    status: z.union([z.literal(""), z.enum(AGENT_CASE_STATUSES)]).optional(),
  })
  .refine((v) => !!(v.title?.trim() || v.summary?.trim() || v.status), { message: "Informe ao menos um campo do caso.", path: ["title"] });
export type CaseCorrectionInput = z.input<typeof caseCorrectionSchema>;
export type CaseCorrectionValues = z.output<typeof caseCorrectionSchema>;

export function caseCorrectionDefaults(data: Data): CaseCorrectionInput {
  return {
    title: text(data.title),
    summary: text(data.summary),
    status: (AGENT_CASE_STATUSES as readonly string[]).includes(text(data.status)) ? (data.status as (typeof AGENT_CASE_STATUSES)[number]) : "",
  };
}

export function caseCorrectionData(original: Data, values: CaseCorrectionValues): Data {
  const before = caseCorrectionDefaults(original);
  const out: Data = { ...original };
  put(out, "title", (values.title ?? "").trim() !== (before.title ?? "").trim(), (values.title ?? "").trim());
  put(out, "summary", (values.summary ?? "").trim() !== (before.summary ?? "").trim(), (values.summary ?? "").trim());
  put(out, "status", (values.status ?? "") !== (before.status ?? ""), values.status);
  return out;
}

/* ------------------------------------------------------------------ */
/* Cadastro de processo (CREATE_PROCESS)                               */
/* ------------------------------------------------------------------ */

const optionalMax = (max: number) => z.string().max(max, `Máximo de ${max} caracteres.`).optional();

export const processCorrectionSchema = z.object({
  cnj: z.string().trim().optional().refine((v) => !v || isCnjFormat(v), msg.cnj),
  court: optionalMax(200),
  courtUnit: optionalMax(200),
  district: optionalMax(200),
  state: z.string().trim().optional().refine((v) => !v || /^[A-Za-z]{2}$/.test(v), "UF com duas letras."),
  legalClass: optionalMax(200),
  subject: optionalMax(500),
  clientSide: z.union([z.literal(""), z.enum(CLIENT_POLES)]).optional(),
  adverseParty: optionalMax(2000),
  caseValue: zCurrencyOptional(),
});
export type ProcessCorrectionInput = z.input<typeof processCorrectionSchema>;
export type ProcessCorrectionValues = z.output<typeof processCorrectionSchema>;

/** Valor numérico → texto no formato brasileiro do formulário ("1.234,56" sem "R$"). */
const moneyText = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";

/** Campo do formulário de processo → chave dos dados do agente. */
const PROCESS_TEXT_FIELDS = [
  ["court", "court"],
  ["courtUnit", "court_unit"],
  ["district", "district"],
  ["legalClass", "legal_class"],
  ["subject", "subject"],
  ["adverseParty", "adverse_party_summary"],
] as const;

export function processCorrectionDefaults(data: Data): ProcessCorrectionInput {
  const out: ProcessCorrectionInput = {
    cnj: text(data.cnj_number),
    state: text(data.state),
    clientSide: (CLIENT_POLES as readonly string[]).includes(text(data.client_side)) ? (data.client_side as (typeof CLIENT_POLES)[number]) : "",
    caseValue: moneyText(data.case_value),
  };
  for (const [field, key] of PROCESS_TEXT_FIELDS) out[field] = text(data[key]);
  return out;
}

export function processCorrectionData(original: Data, values: ProcessCorrectionValues): Data {
  const before = processCorrectionDefaults(original);
  const out: Data = { ...original };
  const digits = (values.cnj ?? "").replace(/\D/g, "");
  put(out, "cnj_number", digits !== (before.cnj ?? "").replace(/\D/g, ""), digits);
  for (const [field, key] of PROCESS_TEXT_FIELDS) put(out, key, (values[field] ?? "").trim() !== (before[field] ?? "").trim(), (values[field] ?? "").trim());
  put(out, "state", (values.state ?? "").trim().toUpperCase() !== (before.state ?? "").trim().toUpperCase(), (values.state ?? "").trim().toUpperCase());
  put(out, "client_side", (values.clientSide ?? "") !== (before.clientSide ?? ""), values.clientSide);
  const reading = readCurrencyInput(values.caseValue);
  const value = reading.kind === "ok" ? reading.value : undefined;
  const beforeReading = readCurrencyInput(before.caseValue);
  put(out, "case_value", value !== (beforeReading.kind === "ok" ? beforeReading.value : undefined), value);
  return out;
}

/* ------------------------------------------------------------------ */
/* Leitura: rótulo e valor de cada campo (resumo e histórico)          */
/* ------------------------------------------------------------------ */

/** Rótulos dos campos de proposta (contrato em server/executor/contract.ts). */
export const PROPOSAL_FIELD_LABEL: Record<string, string> = {
  title: "Título",
  description: "Descrição",
  due_at: "Vencimento",
  priority: "Prioridade",
  deadline_type: "Tipo do prazo",
  legal_process_id: "Processo",
  responsible_user_id: "Responsável",
  category: "Categoria",
  label: "Documento",
  required: "Obrigatório",
  message_to_partner: "Mensagem ao parceiro",
  summary: "Resumo",
  status: "Situação",
  cnj_number: "Número CNJ",
  court: "Tribunal",
  court_unit: "Vara",
  district: "Comarca",
  state: "UF",
  legal_class: "Classe",
  subject: "Assunto",
  client_side: "Polo do cliente",
  adverse_party_summary: "Parte contrária",
  case_value: "Valor da causa",
  skill_slug: "Skill",
  agent_slug: "Agente",
  instructions: "Instruções",
  configuration: "Configuração",
};

/** Valor de um campo da proposta para pessoas. `userName` resolve o responsável. */
export function proposalFieldText(key: string, value: unknown, userName: (id: string) => string | undefined): string {
  if (value === undefined || value === null || value === "") return "—";
  if (key === "due_at" && typeof value === "string") return Number.isNaN(Date.parse(value)) ? value : formatDateTimeAt(value);
  if (key === "priority") return PRIORITY_LABEL[value as Priority] ?? String(value);
  if (key === "deadline_type") return DEADLINE_TYPE_LABEL[value as DeadlineType] ?? String(value);
  if (key === "category") return DOCUMENT_CATEGORY_LABEL[value as DocumentCategory] ?? String(value);
  if (key === "status") return LEGAL_CASE_STATUS_LABEL[value as LegalCaseStatus] ?? String(value);
  if (key === "client_side") return CLIENT_POLE_LABEL[value as (typeof CLIENT_POLES)[number]] ?? String(value);
  if (key === "case_value" && typeof value === "number") return formatCurrency(value);
  if (key === "required" && typeof value === "boolean") return value ? "Sim" : "Não";
  if (key === "responsible_user_id" && typeof value === "string") return userName(value) ?? "Pessoa da equipe";
  if (key === "legal_process_id") return "Processo da proposta";
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

export interface CorrectionRow {
  key: string;
  label: string;
  before: string;
  after: string;
}

/** As linhas "antes → depois" dos campos que mudaram, na ordem dos rótulos. */
export function correctionRows(original: Data, corrected: Data, userName: (id: string) => string | undefined): CorrectionRow[] {
  const keys = [...new Set([...Object.keys(original), ...Object.keys(corrected)])].filter(
    (k) => JSON.stringify(original[k] ?? null) !== JSON.stringify(corrected[k] ?? null),
  );
  const order = Object.keys(PROPOSAL_FIELD_LABEL);
  keys.sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  return keys.map((key) => ({
    key,
    label: PROPOSAL_FIELD_LABEL[key] ?? key,
    before: proposalFieldText(key, original[key], userName),
    after: proposalFieldText(key, corrected[key], userName),
  }));
}

/** Título do formulário de cada tipo. */
export const CORRECTION_TITLE: Record<CorrectableProposalType, string> = {
  CREATE_DEADLINE: "Corrigir o prazo e aprovar",
  REQUEST_DOCUMENT: "Corrigir o pedido de documento e aprovar",
  UPDATE_CASE: "Corrigir a atualização do caso e aprovar",
  CREATE_PROCESS: "Corrigir o cadastro do processo e aprovar",
};
