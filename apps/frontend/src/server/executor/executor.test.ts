import { describe, expect, it, vi } from "vitest";
import { SlidingWindowLimiter } from "@/server/core/rate-limit";
import { createLogger } from "@/server/core/logger";
import { readJsonBody } from "./body";
import { MIN_EXECUTOR_VERSION, executorVersionAccepted, parseExecutorVersion, proposalKey, sha256Hex } from "./contract";
import type { ExecutorDb, ExecutorFunction } from "./db";
import { HttpError, fromDbError, handleExecutorRequest, type ExecutorRequest } from "./handler";

const TOKEN = "dgx_" + "a".repeat(40);
const CLIENT = `dg-executor/${MIN_EXECUTOR_VERSION}`;
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
    signSetupUpload: vi.fn(async () => "https://storage.test/setup-upload?token=z"),
  };
  const silent = createLogger();
  const log = { ...silent, info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = { db, storage, log, limiter: new SlidingWindowLimiter(60_000), newLeaseToken: () => LEASE };
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const req: ExecutorRequest = {
      method,
      segments: path.split("/").filter(Boolean),
      headers: new Headers({ authorization: `Bearer ${TOKEN}`, "x-dg-client": CLIENT, ...headers }),
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
  it("setup (072): reserva a versão, devolve a URL de envio do bucket do setup e publica", async () => {
    const VERSION_ID = "41111111-2222-4333-8444-555555555555";
    const { send, calls, storage } = setup({
      executor_setup_prepare: { id: VERSION_ID, version: "2026.11.14-101500", storage_object_name: "org/2026.11.14-101500.zip" },
      executor_setup_publish: { id: VERSION_ID, version: "2026.11.14-101500", already_published: false },
    });
    const prep = await send("POST", "setup/prepare", { size: 1024, checksum_sha256: "c".repeat(64) });
    expect(prep.status).toBe(200);
    expect(prep.body).toEqual({ id: VERSION_ID, version: "2026.11.14-101500", upload_url: "https://storage.test/setup-upload?token=z" });
    expect(storage.signSetupUpload).toHaveBeenCalledWith("org/2026.11.14-101500.zip");
    expect(storage.signUpload).not.toHaveBeenCalled();
    expect(calls[0]).toEqual({ fn: "executor_setup_prepare", args: [sha256Hex(TOKEN), 1024, "c".repeat(64)] });
    const pub = await send("POST", `setup/${VERSION_ID}/publish`);
    expect(pub.status).toBe(200);
    expect(calls[1]).toEqual({ fn: "executor_setup_publish", args: [sha256Hex(TOKEN), VERSION_ID] });
  });

  it("setup (072): pacote acima de 50 MB ou SHA inválido não chega ao banco", async () => {
    const { send, calls } = setup();
    expect((await send("POST", "setup/prepare", { size: 60 * 1024 * 1024, checksum_sha256: "c".repeat(64) })).status).toBe(422);
    expect((await send("POST", "setup/prepare", { size: 10, checksum_sha256: "xyz" })).status).toBe(422);
    expect((await send("POST", "setup/nao-e-uuid/publish")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("sem token, ou fora do formato: 401, sem tocar no banco", async () => {
    const { calls, deps } = setup();
    const r1 = await handleExecutorRequest({ method: "GET", segments: ["me"], headers: new Headers(), query: new URLSearchParams(), body: undefined }, deps);
    const r2 = await handleExecutorRequest({ method: "GET", segments: ["me"], headers: new Headers({ authorization: "Bearer abc" }), query: new URLSearchParams(), body: undefined }, deps);
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(calls).toHaveLength(0);
  });

  it("o banco recebe só o SHA-256 do token, nunca o token", async () => {
    const { calls, send } = setup({ executor_authenticate: { name: "Computador A" } });
    const r = await send("GET", "me");
    expect(r.status).toBe(200);
    expect(calls[0]).toEqual({ fn: "executor_authenticate", args: [sha256Hex(TOKEN), CLIENT] });
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
  });

  it("versão do conector: abaixo da mínima, sem cabeçalho ou ilegível → 426 com o que fazer, sem tocar no banco", async () => {
    expect(MIN_EXECUTOR_VERSION).toBe("1.3.4");
    expect(parseExecutorVersion("dg-executor/1.3.4")).toEqual([1, 3, 4]);
    expect(parseExecutorVersion("dg-executor/2.0.0-beta.1")).toEqual([2, 0, 0]);
    for (const bad of [null, "", "1.3.4", "dg-executor/1.3", "curl/8.0", "dg-executor/1.3.4; rm -rf"]) expect(parseExecutorVersion(bad)).toBeNull();
    expect(["dg-executor/1.3.4", "dg-executor/1.3.5", "dg-executor/1.4.0", "dg-executor/2.0.0", "dg-executor/1.10.0"].map((v) => executorVersionAccepted(v))).toEqual([true, true, true, true, true]);
    expect(["dg-executor/1.3.3", "dg-executor/1.2.9", "dg-executor/0.9.9", "dg-executor/1.0", null].map((v) => executorVersionAccepted(v))).toEqual([false, false, false, false, false]);

    const { calls, send, log } = setup({ executor_authenticate: { name: "Computador A" }, executor_list_jobs: [] });
    const antigo = await send("GET", "me", undefined, { "x-dg-client": "dg-executor/1.3.3" });
    expect(antigo.status).toBe(426);
    const erro = (antigo.body as { error: { code: string; message: string } }).error;
    expect(erro.code).toBe("CLIENT_OUTDATED");
    expect(erro.message).toBe(
      "O conector do DG Brasil neste computador está na versão 1.3.3, e a mínima aceita é a 1.3.4. " +
        "Rode o instalador de novo neste computador: abra o PowerShell e cole  irm https://app.dgbrasil.adv.br/executor/instalar.ps1 | iex",
    );
    // Vale para qualquer rota, não só para a de identificação.
    expect((await send("GET", "jobs", undefined, { "x-dg-client": "dg-executor/1.2.0" })).status).toBe(426);
    const semVersao = await send("POST", `jobs/${JOB}/claim`, undefined, { "x-dg-client": "" });
    expect(semVersao.status).toBe(426);
    expect((semVersao.body as { error: { message: string } }).error.message).toContain("não informou a versão (ou ela é antiga demais), e a mínima aceita é a 1.3.4.");
    expect(calls).toHaveLength(0);
    expect(log.warn).toHaveBeenCalledWith("executor_api", expect.objectContaining({ status: 426, code: "CLIENT_OUTDATED" }));
    expect((await send("GET", "me")).status).toBe(200);
  });

  it("o corpo só é lido depois do token, do limite de taxa e da versão", async () => {
    const { deps, calls } = setup({ executor_heartbeat: { ok: true } });
    const readBody = vi.fn(async () => ({ progress: "lendo" }));
    const req = (headers: Record<string, string>): ExecutorRequest => ({
      method: "POST", segments: ["jobs", JOB, "heartbeat"], headers: new Headers(headers), query: new URLSearchParams(), readBody,
    });
    expect((await handleExecutorRequest(req({}), deps)).status).toBe(401);
    expect((await handleExecutorRequest(req({ authorization: "Bearer errado" }), deps)).status).toBe(401);
    expect((await handleExecutorRequest(req({ authorization: `Bearer ${TOKEN}`, "x-dg-client": "dg-executor/1.0.0" }), deps)).status).toBe(426);
    expect(readBody).not.toHaveBeenCalled();
    const ok = await handleExecutorRequest(req({ authorization: `Bearer ${TOKEN}`, "x-dg-client": CLIENT, "x-dg-lease": LEASE }), deps);
    expect(ok.status).toBe(200);
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(calls.at(-1)?.args.at(-1)).toBe("lendo");
    // Corpo recusado pelo leitor (grande demais, JSON inválido): a resposta é a dele, sem banco.
    const antes = calls.length;
    const grande = { ...req({ authorization: `Bearer ${TOKEN}`, "x-dg-client": CLIENT, "x-dg-lease": LEASE }), readBody: async () => { throw new HttpError(413, "TOO_LARGE", "Corpo da requisição grande demais."); } };
    expect((await handleExecutorRequest(grande, deps)).status).toBe(413);
    expect(calls).toHaveLength(antes);
  });

  it("leitor do corpo: limite pelo tamanho declarado e pelos bytes recebidos; JSON inválido → 400; vazio → sem corpo", async () => {
    const post = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://dg.test/api/executor/v1/x", { method: "POST", body, headers });
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })), 100)).toEqual({ a: 1 });
    expect(await readJsonBody(post("   "), 100)).toBeUndefined();
    expect(await readJsonBody(new Request("https://dg.test/x"), 100)).toBeUndefined();
    const status = (p: Promise<unknown>) => p.then(() => 200, (e: unknown) => (e instanceof HttpError ? e.status : -1));
    expect(await status(readJsonBody(post("{não é json"), 100))).toBe(400);
    expect(await status(readJsonBody(post("x".repeat(101)), 100))).toBe(413);
    // Content-Length ausente (corpo em fluxo): para de ler quando passa do teto.
    let enviados = 0;
    const fluxo = new ReadableStream<Uint8Array>({
      pull(controller) {
        enviados++;
        controller.enqueue(new Uint8Array(60));
      },
    });
    const emFluxo = new Request("https://dg.test/x", { method: "POST", body: fluxo, duplex: "half" } as RequestInit);
    expect(await status(readJsonBody(emFluxo, 100))).toBe(413);
    expect(enviados).toBeLessThan(10);
  });

  it("erro do banco: texto do Postgres nunca sai (23514 e 22P02); a nossa mensagem em português passa", async () => {
    const check = fromDbError({ code: "23514", message: 'new row for relation "agent_proposals" violates check constraint "agent_proposals_payload_check"' });
    expect([check.status, check.code, check.message]).toEqual([422, "VALIDATION", "Dados inválidos. Confira o que foi enviado."]);
    const syntax = fromDbError({ code: "22P02", message: 'invalid input syntax for type uuid: "abc-do-cliente"' });
    expect([syntax.status, syntax.message]).toEqual([422, "Dados inválidos. Confira o que foi enviado."]);
    // 22P02 é sempre do Postgres: nem um texto "limpo" passa.
    expect(fromDbError({ code: "22P02", message: "Texto qualquer" }).message).toBe("Dados inválidos. Confira o que foi enviado.");
    const nosso = fromDbError({ code: "23514", message: "Minuta só em trabalho ligado a um caso" });
    expect([nosso.status, nosso.message]).toEqual([422, "Minuta só em trabalho ligado a um caso"]);
    expect(fromDbError({ code: "42501", message: "permission denied for function executor_claim" }).message).toBe("Sem permissão.");
    expect(fromDbError({ code: "22023", message: 'column "x" does not exist' }).message).toBe("Dados inválidos. Confira o que foi enviado.");

    const { job } = setup({ executor_create_proposal: Object.assign(new Error('new row for relation "agent_proposals" violates check constraint "x"'), { code: "23514" }) });
    const r = await job("POST", "proposals", { type: "OTHER", summary: "Providência manual", data: { description: "Ligar para o banco" } });
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).not.toMatch(/agent_proposals|constraint|relation/);
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
    // 063: o tipo do prazo pode vir na proposta (o aplicador grava); tipo fora da lista é recusado aqui.
    expect((await job("POST", "proposals", { type: "CREATE_DEADLINE", summary: "Prazo da réplica", data: { ...data, deadline_type: "REPLY" } })).status).toBe(200);
    expect((await job("POST", "proposals", { type: "CREATE_DEADLINE", summary: "Prazo da réplica", data: { ...data, deadline_type: "QUALQUER" } })).status).toBe(422);
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
    expect((await job("POST", "fail", { error_code: "PORTEIRO_BLOQUEOU", message: "Arquivo suspeito" })).status).toBe(200);
    expect((await job("POST", "fail", { error_code: "SEM_PASTA_NO_DRIVE", message: "Sem pasta" })).status).toBe(200);
  });

  it("ponte: dados da pasta do Drive só com a reserva, pela porta do banco que confere o trabalho", async () => {
    const dados = { cliente: { id: JOB, nome: "JOSE DA SILVA FICTICIO" }, pasta_drive: { id: "pastaFicticia_0001", nome: "JOSE DA SILVA FICTICIO" } };
    const { job, send, calls } = setup({ executor_bridge_data: dados });
    expect((await send("GET", `jobs/${JOB}/bridge`)).status).toBe(401);
    const r = await job("GET", "bridge");
    expect(r.body).toEqual(dados);
    const c = calls.find((x) => x.fn === "executor_bridge_data")!;
    expect(c.args).toEqual([sha256Hex(TOKEN), JOB, sha256Hex(LEASE)]);
  });

  it("verificar agora: só com o token do computador, pela porta atômica do banco, e só três campos saem", async () => {
    const { send, calls } = setup({
      executor_wake_poll: { wake: true, execution_enabled: true, newest_job_at: "2026-11-11T12:00:00Z", extra: "JOSE DA SILVA FICTICIO" },
    });
    const r = await send("POST", "wake");
    expect(r).toEqual({ status: 200, body: { wake: true, execution_enabled: true, newest_job_at: "2026-11-11T12:00:00Z" } });
    expect(calls).toEqual([{ fn: "executor_wake_poll", args: [sha256Hex(TOKEN)] }]);
    expect((await send("GET", "wake")).status).toBe(404);
  });

  it("verificar agora: computador revogado recebe 403, sem tocar em mais nada", async () => {
    const revogado = Object.assign(new Error("Acesso do computador inválido ou revogado"), { code: "42501" });
    const { send } = setup({ executor_wake_poll: revogado });
    expect((await send("POST", "wake")).status).toBe(403);
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
