import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Contrato da API do computador do escritório (/api/executor/v1).
 *
 * O MCP local repassa o que o Claude Code pede; quem valida é AQUI e no banco
 * (private.executor_*). Erro de validação volta com mensagem clara para o
 * agente corrigir. Os formatos de análise e proposta são os mesmos que o
 * worker da Etapa 5 usava (schema_version 1), para a tela e Revisões não
 * mudarem.
 */

export const EXECUTOR_TOKEN = /^dgx_[A-Za-z0-9_-]{20,100}$/;
export const LEASE_TOKEN = /^dgl_[A-Za-z0-9_-]{20,100}$/;

export const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

const texto = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();

// ── análise (schema_version 1) ─────────────────────────────────────────────

export const ANALYSIS_SCHEMA_VERSION = 1;

export const analysisResultSchema = z.object({
  summary: texto(4000),
  recommendation: texto(4000),
  findings: z.array(z.object({
    title: texto(300),
    detail: texto(4000),
    relevance: z.enum(["HIGH", "MEDIUM", "LOW"]),
    document_version_ids: z.array(uuid).max(50),
  }).strict()).max(50),
  missing_information: z.array(texto(1000)).max(50),
  recommendations: z.array(texto(2000)).max(50),
  proposed_actions: z.array(z.object({
    description: texto(2000),
    proposal_type: z.enum(["CREATE_DEADLINE", "REQUEST_DOCUMENT", "UPDATE_CASE", "CREATE_PROCESS", "OTHER"]).nullable(),
  }).strict()).max(30),
  references_used: z.array(z.object({
    reference_id: uuid,
    title: texto(300),
    how_used: texto(1000),
  }).strict()).max(50),
  theses_considered: z.array(z.object({
    thesis_id: uuid,
    applicable: z.boolean(),
    rationale: texto(2000),
  }).strict()).max(50),
}).strict();
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

export const submitAnalysisSchema = z.object({ result: analysisResultSchema }).strict();

/** O que vai para o banco: o resultado + título de cada tese + ids das aplicáveis (a tela lê). */
export function analysisForStorage(r: AnalysisResult, thesisTitles: Map<string, string>): Record<string, unknown> {
  return {
    ...r,
    theses_considered: r.theses_considered.map((t) => ({ ...t, title: thesisTitles.get(t.thesis_id) ?? null })),
    identified_thesis_ids: r.theses_considered.filter((t) => t.applicable).map((t) => t.thesis_id),
  };
}

// ── propostas ──────────────────────────────────────────────────────────────

const isoDate = z.string().datetime({ offset: true });
const CASE_STATUS_FOR_AGENT = ["WAITING_DOCUMENTS", "READY_FOR_ANALYSIS", "ANALYZING", "WAITING_REVIEW"] as const;

/** Tipos que o computador pode propor. Estruturais (agente, skill) ficam de fora. */
export const PROPOSAL_DATA = {
  CREATE_DEADLINE: z.object({
    title: z.string().min(3).max(200),
    description: z.string().max(4000).optional(),
    due_at: isoDate,
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
    legal_process_id: uuid.optional(),
    responsible_user_id: uuid.optional(),
  }).strict(),
  REQUEST_DOCUMENT: z.object({
    category: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "categoria em CAIXA_ALTA, ex.: BENEFIT_STATEMENT"),
    label: z.string().min(3).max(200),
    required: z.boolean().default(true),
    message_to_partner: z.string().max(2000).optional(),
    due_at: isoDate.optional(),
  }).strict(),
  UPDATE_CASE: z.object({
    title: z.string().min(3).max(200).optional(),
    summary: z.string().max(8000).optional(),
    status: z.enum(CASE_STATUS_FOR_AGENT).optional(),
  }).strict().refine((p) => Object.values(p).some((v) => v !== undefined), "informe ao menos um campo"),
  CREATE_PROCESS: z.object({
    cnj_number: z.string().regex(/^[0-9]{20}$/, "CNJ só com os 20 dígitos").optional(),
    court: z.string().max(200).optional(),
    court_unit: z.string().max(200).optional(),
    district: z.string().max(200).optional(),
    state: z.string().regex(/^[A-Z]{2}$/).optional(),
    legal_class: z.string().max(200).optional(),
    subject: z.string().max(500).optional(),
    client_side: z.enum(["ACTIVE", "PASSIVE", "THIRD_PARTY"]).optional(),
    adverse_party_summary: z.string().max(2000).optional(),
    case_value: z.number().nonnegative().optional(),
  }).strict(),
  OTHER: z.object({ description: z.string().min(10).max(4000) }).strict(),
} as const;
export type ProposalType = keyof typeof PROPOSAL_DATA;
export const PROPOSAL_TYPES = Object.keys(PROPOSAL_DATA) as [ProposalType, ...ProposalType[]];

export const createProposalSchema = z.object({
  type: z.enum(PROPOSAL_TYPES),
  summary: z.string().trim().min(10).max(300),
  data: z.record(z.string(), z.unknown()),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
}).strict();

/** Mesma proposta (tipo + dados) no mesmo trabalho = a mesma linha (unique no banco). */
export function proposalKey(type: ProposalType, data: Record<string, unknown>): string {
  return `prop:${sha256Hex(`${type}:${canonical(data)}`).slice(0, 40)}`;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

// ── minutas ────────────────────────────────────────────────────────────────

export const OUTPUT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
};
export const OUTPUT_MAX_BYTES = 50 * 1024 * 1024;

const filename = z.string().trim().min(1).max(200).refine((n) => !/[\\/:*?"<>|\u0000-\u001f]/.test(n) && !n.startsWith("."), "nome de arquivo inválido");

export const prepareOutputSchema = z.object({
  filename,
  mime_type: z.enum(Object.values(OUTPUT_MIME) as [string, ...string[]]),
  size: z.number().int().positive().max(OUTPUT_MAX_BYTES),
}).strict().refine((o) => OUTPUT_MIME[extensionOf(o.filename)] === o.mime_type, "extensão e tipo do arquivo não combinam");

export const finalizeOutputSchema = z.object({
  document_id: uuid,
  storage_object_name: z.string().min(10).max(500),
  filename,
  mime_type: z.enum(Object.values(OUTPUT_MIME) as [string, ...string[]]),
  size: z.number().int().positive().max(OUTPUT_MAX_BYTES),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().trim().min(3).max(200),
  category: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "categoria em CAIXA_ALTA, ex.: PETITION, POWER_OF_ATTORNEY"),
  description: z.string().max(2000).optional(),
}).strict();

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

// ── ciclo do trabalho ──────────────────────────────────────────────────────

export const heartbeatSchema = z.object({ progress: z.string().trim().min(1).max(200).optional() }).strict();

export const EXECUTOR_ERROR_CODES = [
  "MISSING_INPUT", "DOCUMENT_CHECKSUM_MISMATCH", "DOCUMENT_UNREADABLE", "INVALID_OUTPUT", "TOOL_ERROR",
  "AGENT_NOT_FOUND", "AGENT_ERROR", "CONFIGURATION_ERROR", "INTERRUPTED", "INTERNAL_ERROR",
] as const;

export const failSchema = z.object({
  error_code: z.enum(EXECUTOR_ERROR_CODES),
  message: z.string().trim().min(1).max(1000),
  retryable: z.boolean().default(false),
}).strict();

export const completeSchema = z.object({
  report: z.object({
    client_version: z.string().max(120).optional(),
    claude_code_version: z.string().max(60).optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    documents_downloaded: z.number().int().nonnegative().optional(),
    mode: z.enum(["ASSISTED", "AUTOMATIC"]).optional(),
  }).strict().default({}),
}).strict();

export const configSchema = z.object({
  snapshot: z.object({
    client_version: z.string().max(120),
    claude_code_version: z.string().max(60).optional(),
    mode: z.enum(["ASSISTED", "AUTOMATIC"]),
    local_agent: z.string().max(64).nullable(),
    agent_version_id: uuid,
  }).strict(),
}).strict();
