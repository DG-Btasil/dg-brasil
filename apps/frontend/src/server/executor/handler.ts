import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Logger } from "@/server/core/logger";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import {
  ANALYSIS_SCHEMA_VERSION, EXECUTOR_TOKEN, LEASE_TOKEN, PROPOSAL_DATA, analysisForStorage, completeSchema, configSchema,
  createProposalSchema, failSchema, finalizeOutputSchema, heartbeatSchema, prepareOutputSchema, proposalKey, sha256Hex,
  submitAnalysisSchema,
} from "./contract";
import type { ExecutorDb, ExecutorFunction } from "./db";
import type { ExecutorStorage } from "./storage";

/**
 * API do computador do escritório (/api/executor/v1/...). Sem sessão de
 * navegador: autentica pelo token do computador (Authorization: Bearer dgx_…)
 * e, nas rotas de um trabalho, pelo token de reserva (X-DG-Lease: dgl_…). Os
 * dois chegam ao banco só como SHA-256. A decisão de acesso é do banco
 * (private.executor_*); aqui: formato, limite de taxa, validação do conteúdo e
 * assinatura de URL do Storage para o caminho que o banco autorizou.
 *
 * Respostas nunca carregam token, hash nem mensagem técnica de erro interno.
 */

export interface ExecutorRequest {
  method: string;
  segments: string[];
  headers: Headers;
  query: URLSearchParams;
  body: unknown;
}

export interface ExecutorResponse {
  status: number;
  body: unknown;
}

export interface ExecutorDeps {
  db: ExecutorDb;
  storage: ExecutorStorage;
  log: Logger;
  limiter?: SlidingWindowLimiter;
  newLeaseToken?: () => string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sharedLimiter = new SlidingWindowLimiter(60_000);
const LIMIT_PER_MINUTE = 300;

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const ok = (body: unknown, status = 200): ExecutorResponse => ({ status, body });
const fail = (status: number, code: string, message: string): ExecutorResponse => ({ status, body: { error: { code, message } } });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const detail = r.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`).join("; ");
    throw new HttpError(422, "VALIDATION", `Dados inválidos — ${detail}`);
  }
  return r.data;
}

/** Erro do Postgres → HTTP. As mensagens das funções executor_* são nossas, em português e sem dado de cliente. */
export function fromDbError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  const err = e as { code?: string; message?: string };
  const message = typeof err?.message === "string" ? err.message.slice(0, 300) : "";
  switch (err?.code) {
    case "42501": return new HttpError(403, "FORBIDDEN", message || "Sem permissão.");
    case "P0002": return new HttpError(404, "NOT_FOUND", message || "Não encontrado.");
    case "22023":
    case "23514":
    case "22P02": return new HttpError(422, "VALIDATION", message || "Dados inválidos.");
    case "55000": return new HttpError(409, "INTERRUPTED", message || "Trabalho interrompido a pedido.");
    case "23505": return new HttpError(409, "CONFLICT", "Já existe.");
    case "23503": return new HttpError(422, "VALIDATION", "Referência inexistente (categoria, processo ou documento).");
    default: return new HttpError(500, "INTERNAL", "Erro interno. Tente de novo em instantes.");
  }
}

export async function handleExecutorRequest(req: ExecutorRequest, deps: ExecutorDeps): Promise<ExecutorResponse> {
  const started = Date.now();
  const route = routeName(req.segments);
  try {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!EXECUTOR_TOKEN.test(token)) return fail(401, "UNAUTHENTICATED", "Token do computador ausente ou em formato inválido.");
    const tokenHash = sha256Hex(token);

    const limiter = deps.limiter ?? sharedLimiter;
    const rate = limiter.consume([{ key: `executor:${tokenHash.slice(0, 16)}`, limit: LIMIT_PER_MINUTE }]);
    if (!rate.allowed) return fail(429, "RATE_LIMITED", "Muitas chamadas seguidas. Espere um pouco.");

    const res = await route_(req, tokenHash, deps);
    deps.log.info("executor_api", { route, status: res.status, durationMs: Date.now() - started });
    return res;
  } catch (e) {
    const h = fromDbError(e);
    const level = h.status >= 500 ? "error" : "warn";
    deps.log[level]("executor_api", {
      route, status: h.status, code: h.code, dbCode: (e as { code?: string })?.code ?? null, durationMs: Date.now() - started,
    });
    return fail(h.status, h.code, h.message);
  }
}

function routeName(segments: string[]): string {
  return segments.map((s) => (UUID.test(s) ? ":id" : s)).join("/").slice(0, 80);
}

async function route_(req: ExecutorRequest, tokenHash: string, deps: ExecutorDeps): Promise<ExecutorResponse> {
  const { db } = deps;
  const s = req.segments;
  const m = req.method;
  const call = <T = unknown>(fn: ExecutorFunction, ...args: unknown[]) => db.call<T>(fn, [tokenHash, ...args]);

  if (s.length === 1 && s[0] === "me" && m === "GET") {
    const version = (req.headers.get("x-dg-client") ?? "").slice(0, 120) || null;
    return ok(await call("executor_authenticate", version));
  }
  if (s.length === 1 && s[0] === "jobs" && m === "GET") {
    const limit = Math.min(Math.max(Number(req.query.get("limit") ?? 20) || 20, 1), 50);
    return ok({ jobs: await call("executor_list_jobs", limit) });
  }
  if (s[0] !== "jobs" || s.length < 3 || !UUID.test(s[1])) throw new HttpError(404, "NOT_FOUND", "Rota inexistente.");

  const jobId = s[1];
  const action = s.slice(2);

  if (action.length === 1 && action[0] === "claim" && m === "POST") {
    const leaseToken = (deps.newLeaseToken ?? newLeaseToken)();
    const r = await call<{ claimed: boolean; reason?: string; status?: string; attempt?: number; context?: unknown }>(
      "executor_claim", jobId, sha256Hex(leaseToken));
    if (!r.claimed) return ok({ claimed: false, reason: r.reason ?? "NOT_AVAILABLE", status: r.status ?? null });
    return ok({ claimed: true, lease_token: leaseToken, attempt: r.attempt, context: r.context });
  }

  // Daqui para baixo: a reserva.
  const lease = req.headers.get("x-dg-lease") ?? "";
  if (!LEASE_TOKEN.test(lease)) throw new HttpError(401, "LEASE_REQUIRED", "Token de reserva ausente ou em formato inválido.");
  const leaseHash = sha256Hex(lease);
  const job = <T = unknown>(fn: ExecutorFunction, ...args: unknown[]) => call<T>(fn, jobId, leaseHash, ...args);
  const key = `${m} ${action.map((a) => (UUID.test(a) ? ":id" : a)).join("/")}`;

  switch (key) {
    case "GET context":
      return ok(await job("executor_job_context"));
    case "POST heartbeat": {
      const b = parse(heartbeatSchema, req.body);
      return ok(await job("executor_heartbeat", b.progress ?? null));
    }
    case "GET case":
      return ok(await job("executor_get_case"));
    case "GET processes/:id": {
      const p = await job("executor_get_process", action[1]);
      if (!p) throw new HttpError(404, "NOT_FOUND", "Processo não pertence ao caso deste trabalho.");
      return ok(p);
    }
    case "GET documents":
      return ok({ documents: await job("executor_list_documents") });
    case "POST documents/:id/download": {
      const d = await job<{ storage_object_name: string; filename: string | null; title: string } & Record<string, unknown>>(
        "executor_open_document", action[1]);
      const name = d.filename ?? `${d.title}.bin`;
      const url = await deps.storage.signDownload("legal-documents", d.storage_object_name, name);
      const { storage_object_name: _hidden, ...meta } = d;
      return ok({ ...meta, filename: name, url, expires_in: 120 });
    }
    case "GET theses":
      return ok({ theses: await job("executor_list_theses") });
    case "GET references":
      return ok({ references: await job("executor_list_references", null) });
    case "POST references/:id/open": {
      const list = await job<Array<{ id: string; title: string; type: string; content_text: string | null;
        storage_object_name: string | null; filename: string | null; mime_type: string | null; version_id: string }>>(
        "executor_list_references", action[1]);
      const r = list[0];
      if (!r) throw new HttpError(404, "NOT_FOUND", "Referência não autorizada para este agente.");
      if (r.content_text) return ok({ id: r.id, version_id: r.version_id, title: r.title, type: r.type, kind: "text", text: r.content_text });
      if (!r.storage_object_name) throw new HttpError(422, "VALIDATION", "Referência sem conteúdo.");
      const filename = r.filename ?? `referencia-${r.id.slice(0, 8)}.pdf`;
      const url = await deps.storage.signDownload("reference-materials", r.storage_object_name, filename);
      return ok({ id: r.id, version_id: r.version_id, title: r.title, type: r.type, kind: "file", filename, mime_type: r.mime_type, url, expires_in: 120 });
    }
    case "POST analysis":
      return ok(await submitAnalysis(job, parse(submitAnalysisSchema, req.body).result));
    case "POST proposals": {
      const b = parse(createProposalSchema, req.body);
      const data = parse(PROPOSAL_DATA[b.type] as z.ZodType<Record<string, unknown>>, b.data);
      const processId = typeof data.legal_process_id === "string" ? data.legal_process_id : null;
      return ok(await job("executor_create_proposal", b.type, { summary: b.summary, data }, proposalKey(b.type, data), b.priority, processId));
    }
    case "POST outputs": {
      const b = parse(prepareOutputSchema, req.body);
      const p = await job<{ document_id: string; document_version_id: string; storage_object_name: string }>(
        "executor_prepare_output", b.filename, b.mime_type, b.size);
      const uploadUrl = await deps.storage.signUpload(p.storage_object_name);
      return ok({ ...p, upload_url: uploadUrl });
    }
    case "POST outputs/:id/finalize": {
      const b = parse(finalizeOutputSchema, req.body);
      return ok(await job("executor_finalize_output", b.document_id, action[1], b.storage_object_name, b.filename, b.mime_type,
        b.size, b.checksum_sha256, b.title, b.category, b.description ?? null));
    }
    case "POST config":
      return ok({ recorded: await job("executor_record_config", parse(configSchema, req.body).snapshot) });
    case "POST complete":
      return ok(await job("executor_complete", parse(completeSchema, req.body).report));
    case "POST fail": {
      const b = parse(failSchema, req.body);
      return ok(await job("executor_fail", b.error_code, b.message, b.retryable));
    }
    case "POST release":
      return ok(await job("executor_release"));
    default:
      throw new HttpError(404, "NOT_FOUND", "Rota inexistente.");
  }
}

/**
 * Análise: além do formato, a mesma regra da Etapa 5 — só pode citar tese e
 * referência autorizadas para este trabalho (o banco devolve a lista).
 */
async function submitAnalysis(
  job: <T = unknown>(fn: ExecutorFunction, ...args: unknown[]) => Promise<T>,
  result: z.infer<typeof submitAnalysisSchema>["result"],
) {
  const theses = await job<Array<{ id: string; title: string }>>("executor_list_theses");
  const titles = new Map(theses.map((t) => [t.id, t.title]));
  const unknownThesis = result.theses_considered.find((t) => !titles.has(t.thesis_id));
  if (unknownThesis) throw new HttpError(422, "VALIDATION", `Tese ${unknownThesis.thesis_id} não é autorizada para este trabalho.`);
  if (result.references_used.length) {
    const refs = new Set((await job<Array<{ id: string }>>("executor_list_references", null)).map((r) => r.id));
    const unknownRef = result.references_used.find((r) => !refs.has(r.reference_id));
    if (unknownRef) throw new HttpError(422, "VALIDATION", `Referência ${unknownRef.reference_id} não é autorizada para este trabalho.`);
  }
  return job("executor_submit_analysis", result.summary, analysisForStorage(result, titles), ANALYSIS_SCHEMA_VERSION);
}

function newLeaseToken(): string {
  return `dgl_${randomBytes(32).toString("base64url")}`;
}
