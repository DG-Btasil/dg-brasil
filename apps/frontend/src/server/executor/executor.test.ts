import { describe, expect, it, vi } from "vitest";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import { createLogger } from "@/server/core/logger";
import { proposalKey, sha256Hex } from "./contract";
import type { ExecutorDb, ExecutorFunction } from "./db";
import { handleExecutorRequest, type ExecutorRequest } from "./handler";

const TOKEN = "dgx_" + "a".repeat(40);
const LEASE = "dgl_" + "b".repeat(43);
const JOB = "11111111-2222-4333-8444-555555555555";
const THESIS = "21111111-2222-4333-8444-555555555555";
const REF = "31111111-2222-4333-8444-555555555555";

type Call = { fn: ExecutorFunction; args: unknown[] };

function setup(responses: Partial<Record<ExecutorFunction, unknown | ((args: unknown[]) => unknown)>> = {}) {
  const calls: Call[] = [];
  const db: ExecutorDb = {
    async call<T>(fn: ExecutorFunction, args: unknown[]) {
      calls.push({ fn, args });
      const r = responses[fn];
      if (r instanceof Error) throw r;
      return (typeof r === "function" ? (r as (a: unknown[]) => unknown)(args) : r) as T;
    },
  };
  const storage = {
    signDownload: vi.fn(async () => "https://storage.test/download?token=x"),
    signUpload: vi.fn(async () => "https://storage.test/upload?token=y"),
  };
  const silent = createLogger();
  const log = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db, storage, log, limiter: new SlidingWindowLimiter(60_000), newLeaseToken: () => LEASE };
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req: ExecutorRequest = {
      method,
      segments: path.split("/").filter(Boolean),
      headers: new Headers({ authorization: `Bearer ${TOKEN}`, ...headers }),
      query: new URLSearchParams(),
      body,
    };
    return handleExecutorRequest(req, deps);
  };
  const job = (method: string, action: string, body?: unknown) => send(method, `jobs/${JOB}/${action}`, body, { "x-dg-lease": LEASE });
  return { calls, storage, log, send, job, deps };
}

const result = {
  summary: "Cabem duas ações.",
  recommendation: "Ajuizar no JEC",
  findings: [{ title: "Migração", detail: "Contrato migrado", relevance: "HIGH", document_version_ids: [] }],
  missing_information: [],
  recommendations: [],
  proposed_actions: [{ description: "Pedir extrato", proposal_type: null }],
  references_used: [],
  theses_considered: [{ thesis_id: THESIS, applicable: true, rationale: "Contrato migrado sem benefício." }],
};

describe("API do computador do escritório", () => {
  it("sem token, ou fora do formato: 401, sem tocar no banco", async () => {
    const { calls, deps } = setup();
    const r1 = await handleExecutorRequest({ method: "GET", segments: ["me"], headers: new Headers(), query: new URLSearchParams(), body: undefined }, deps);
    const r2 = await handleExecutorRequest({ method: "GET", segments: ["me"], headers: new Headers({ authorization: "Bearer abc" }), query: new URLSearchParams(), body: undefined }, deps);
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(calls).toHaveLength(0);
  });

  it("o banco recebe só o SHA-256 do token, nunca o token", async () => {
    const { calls, send } = setup({ executor_authenticate: { name: "Computador A" } });
    const r = await send("GET", "me", undefined, { "x-dg-client": "dg-executor/1.0" });
    expect(r.status).toBe(200);
    expect(calls[0]).toEqual({ fn: "executor_authenticate", args: [sha256Hex(TOKEN), "dg-executor/1.0"] });
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("reserva: o servidor cria o token de reserva, manda só o hash e devolve o token uma vez", async () => {
    const { calls, send } = setup({ executor_claim: { claimed: true, attempt: 1, context: { id: JOB } } });
    const r = await send("POST", `jobs/${JOB}/claim`);
    expect(r.body).toMatchObject({ claimed: true, lease_token: LEASE, attempt: 1 });
    expect(calls[0].args).toEqual([sha256Hex(TOKEN), JOB, sha256Hex(LEASE)]);
  });

  it("reserva recusada: sem token de reserva na resposta", async () => {
    const { send } = setup({ executor_claim: { claimed: false, reason: "DISABLED" } });
    const r = await send("POST", `jobs/${JOB}/claim`);
    expect(r.body).toEqual({ claimed: false, reason: "DISABLED", status: null });
  });

  it("rota de trabalho sem token de reserva: 401", async () => {
    const { send, calls } = setup();
    const r = await send("GET", `jobs/${JOB}/case`);
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("download: assina o caminho que o banco autorizou e não devolve o caminho interno", async () => {
    const { job, storage } = setup({
      executor_open_document: { storage_object_name: "clients/x/documents/y/z/hiscon.pdf", filename: "hiscon.pdf", title: "HISCON", checksum_sha256: "c".repeat(64) },
    });
    const r = await job("POST", `documents/${JOB}/download`);
    expect(storage.signDownload).toHaveBeenCalledWith("legal-documents", "clients/x/documents/y/z/hiscon.pdf", "hiscon.pdf");
    expect(r.body).toMatchObject({ url: "https://storage.test/download?token=x", checksum_sha256: "c".repeat(64), expires_in: 120 });
    expect(JSON.stringify(r.body)).not.toContain("clients/x");
  });

  it("análise: formato inválido → 422 com o motivo", async () => {
    const { job, calls } = setup();
    const r = await job("POST", "analysis", { result: { ...result, recommendation: "" } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain("recommendation");
    expect(calls).toHaveLength(0);
  });

  it("análise: tese ou referência fora das autorizadas → 422", async () => {
    const { job } = setup({ executor_list_theses: [], executor_list_references: [] });
    expect((await job("POST", "analysis", { result })).status).toBe(422);
    const { job: job2 } = setup({ executor_list_theses: [{ id: THESIS, title: "Migração" }], executor_list_references: [] });
    const r = await job2("POST", "analysis", { result: { ...result, references_used: [{ reference_id: REF, title: "x", how_used: "y" }] } });
    expect(r.status).toBe(422);
  });

  it("análise válida: grava com título da tese e ids das aplicáveis", async () => {
    const { job, calls } = setup({ executor_list_theses: [{ id: THESIS, title: "Migração sem benefício" }], executor_submit_analysis: { created: true } });
    const r = await job("POST", "analysis", { result });
    expect(r.status).toBe(200);
    const submit = calls.find((c) => c.fn === "executor_submit_analysis")!;
    const stored = submit.args[4] as Record<string, unknown>;
    expect(submit.args[3]).toBe("Cabem duas ações.");
    expect(stored.identified_thesis_ids).toEqual([THESIS]);
    expect((stored.theses_considered as Array<{ title: string }>)[0].title).toBe("Migração sem benefício");
  });

  it("proposta: tipo estrutural e dados incompletos → 422; válida → chave determinística e processo", async () => {
    const { job, calls } = setup({ executor_create_proposal: { created: true } });
    expect((await job("POST", "proposals", { type: "UPDATE_AGENT", summary: "Mudar o agente aqui", data: {} })).status).toBe(422);
    expect((await job("POST", "proposals", { type: "CREATE_DEADLINE", summary: "Prazo da réplica", data: { title: "Réplica" } })).status).toBe(422);
    const data = { title: "Réplica", due_at: "2026-12-01T12:00:00Z", legal_process_id: JOB };
    const r = await job("POST", "proposals", { type: "CREATE_DEADLINE", summary: "Prazo da réplica", data });
    expect(r.status).toBe(200);
    const c = calls.find((x) => x.fn === "executor_create_proposal")!;
    expect(c.args.slice(3)).toEqual(["CREATE_DEADLINE", { summary: "Prazo da réplica", data: { ...data, priority: "NORMAL" } },
      proposalKey("CREATE_DEADLINE", { ...data, priority: "NORMAL" }), "NORMAL", JOB]);
  });

  it("minuta: extensão e tipo precisam combinar; envio assinado no caminho do banco", async () => {
    const { job, storage } = setup({ executor_prepare_output: { document_id: JOB, document_version_id: THESIS, storage_object_name: "clients/c/documents/d/v/procuracao.pdf" } });
    expect((await job("POST", "outputs", { filename: "procuracao.pdf", mime_type: "text/plain", size: 10 })).status).toBe(422);
    expect((await job("POST", "outputs", { filename: "../x.pdf", mime_type: "application/pdf", size: 10 })).status).toBe(422);
    const r = await job("POST", "outputs", { filename: "procuracao.pdf", mime_type: "application/pdf", size: 10 });
    expect(r.body).toMatchObject({ upload_url: "https://storage.test/upload?token=y" });
    expect(storage.signUpload).toHaveBeenCalledWith("clients/c/documents/d/v/procuracao.pdf");
  });

  it("falha: só códigos conhecidos", async () => {
    const { job } = setup({ executor_fail: { status: "QUEUED" } });
    expect((await job("POST", "fail", { error_code: "QUALQUER", message: "x" })).status).toBe(422);
    expect((await job("POST", "fail", { error_code: "DOCUMENT_UNREADABLE", message: "PDF ilegível", retryable: true })).status).toBe(200);
  });

  it("erro do banco: permissão vira 403 com a mensagem; erro desconhecido vira 500 genérico", async () => {
    const negado = Object.assign(new Error("Trabalho não está reservado por este computador"), { code: "42501" });
    const { job } = setup({ executor_get_case: negado });
    const r = await job("GET", "case");
    expect(r).toEqual({ status: 403, body: { error: { code: "FORBIDDEN", message: "Trabalho não está reservado por este computador" } } });
    const interno = Object.assign(new Error("connection to 10.0.0.1 failed: senha=xyz"), { code: "08006" });
    const { job: job2 } = setup({ executor_get_case: interno });
    const r2 = await job2("GET", "case");
    expect(r2.status).toBe(500);
    expect(JSON.stringify(r2.body)).not.toContain("10.0.0.1");
  });

  it("interrupção pedida: 409", async () => {
    const { job } = setup({ executor_create_proposal: Object.assign(new Error("Trabalho interrompido a pedido"), { code: "55000" }) });
    const r = await job("POST", "proposals", { type: "OTHER", summary: "Providência manual", data: { description: "Ligar para o banco" } });
    expect(r.status).toBe(409);
  });

  it("limite de chamadas por computador: 429", async () => {
    const { send, deps } = setup({ executor_list_jobs: [] });
    deps.limiter = new SlidingWindowLimiter(60_000);
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await send("GET", "jobs")).status;
    expect(last).toBe(429);
  });

  it("rota inexistente: 404", async () => {
    const { job, send } = setup();
    expect((await job("POST", "apagar")).status).toBe(404);
    expect((await send("GET", "jobs/nao-e-uuid/case")).status).toBe(404);
  });
});
