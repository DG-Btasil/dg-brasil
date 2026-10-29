import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/server/core/logger";
import * as agents from "@/server/domain/agents/service";
import * as dg from "@/server/domain/dg/service";
import { saveAgentSchema } from "@/server/domain/dg/schemas";
import { pgExecutorDb } from "@/server/executor/db";
import { handleExecutorRequest, type ExecutorDeps } from "@/server/executor/handler";
import { signedExecutorStorage } from "@/server/executor/storage";
import { integrationEnv } from "./support/env";
import { ctxFor, dbFor, expectDomainError, serviceDb, world } from "./support/world";

/**
 * API do computador do escritório (/api/executor/v1, migration 040) contra o
 * Supabase DEV real: token do computador, reserva exclusiva, escopo do caso,
 * minuta enviada ao Storage pela URL assinada e baixada de volta com o
 * checksum, proposta, conclusão, linha do tempo e revogação. Pelo mesmo
 * handler da rota do Next.js, com o login dg_worker (DG_WORKER_DB_URL).
 * Dados FICTÍCIOS. Nenhuma IA roda.
 */

integrationEnv();
if (!process.env.DG_WORKER_DB_URL) {
  throw new Error("Falta DG_WORKER_DB_URL em supabase/.env.real (login dg_worker pelo pooler IPv4 do Supabase).");
}

const svc = serviceDb();
const tag = `mcp-${world.run}`;
const deps: ExecutorDeps = { db: pgExecutorDb(), storage: signedExecutorStorage(), log: createLogger({ test: "mcp" }) };
const state: { tokenA: string; tokenB: string; executorA: string; executorB: string; agentId: string; runId: string; lease: string; caseId: string } =
  { tokenA: "", tokenB: "", executorA: "", executorB: "", agentId: "", runId: "", lease: "", caseId: "" };

function send(method: string, path: string, opts: { token?: string; lease?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.lease) headers.set("x-dg-lease", opts.lease);
  return handleExecutorRequest({ method, segments: path.split("/").filter(Boolean), headers, query: new URLSearchParams(), body: opts.body }, deps);
}
const job = (method: string, action: string, body?: unknown, token = state.tokenA, lease = state.lease) =>
  send(method, `jobs/${state.runId}/${action}`, { token, lease, body });

beforeAll(async () => {
  const admin = await ctxFor("ADMIN");
  const a = await dg.createExecutor(admin, `Computador A ${tag}`);
  const b = await dg.createExecutor(admin, `Computador B ${tag}`);
  Object.assign(state, { tokenA: a.token, executorA: a.id, tokenB: b.token, executorB: b.id });
  const agent = await dg.saveAgent(admin, saveAgentSchema.parse({
    key: randomUUID(), name: `Kit ${tag}`, status: "ACTIVE", instructions: "Entregue a procuração (teste) com entregar_minuta.",
    config: { localAgent: "kit-cliente-teste" }, thesisIds: [], referenceIds: [],
  }));
  state.agentId = agent.id;
  const caseRow = await dbFor("PARTNER_ADMIN_A").rpc("partner_submit_case", {
    p_client: { document: `999${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: `Cliente Fictício ${tag}` },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso MCP ${tag}`, origin_organization_id: world.partnerA },
  });
  if (caseRow.error) throw new Error(caseRow.error.message);
  state.caseId = (caseRow.data as { legal_case_id: string }).legal_case_id;
  const run = await agents.requestAgentRun(await ctxFor("LAWYER"), {
    idempotencyKey: randomUUID(), agentId: state.agentId, legalCaseId: state.caseId, requestText: "Gere a procuração de teste.", operation: "EXECUTE",
  });
  state.runId = run.runId;
});

afterAll(async () => {
  const admin = await ctxFor("ADMIN");
  await dg.setAiEnabled(admin, false, "fim do teste de integração MCP");
  for (const id of [state.executorA, state.executorB]) if (id) await dg.revokeExecutor(admin, id).catch(() => undefined);
  if (state.agentId) await svc.from("agents").update({ status: "INACTIVE" }).eq("id", state.agentId);
  if (state.runId) await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("id", state.runId).in("status", ["QUEUED", "RUNNING", "WAITING_HUMAN"]);
});

describe("computador do escritório: acesso", () => {
  it("token só aparece na criação; o banco guarda o hash; LAWYER não autoriza computador", async () => {
    const { data } = await svc.from("executors").select("token_hash, token_prefix").eq("id", state.executorA).single();
    expect(data?.token_hash).toBe(createHash("sha256").update(state.tokenA).digest("hex"));
    expect(state.tokenA.startsWith(data!.token_prefix)).toBe(true);
    await expectDomainError(dg.createExecutor(await ctxFor("LAWYER"), "Intruso"), "FORBIDDEN");
  });

  it("autentica pelo token; token desconhecido é recusado", async () => {
    expect((await send("GET", "me", { token: state.tokenA })).body).toMatchObject({ name: `Computador A ${tag}` });
    expect((await send("GET", "me", { token: `dgx_${"z".repeat(43)}` })).status).toBe(403);
    expect((await send("GET", "me")).status).toBe(401);
  });

  it("ADMIN vê o computador como conectado depois do contato", async () => {
    const s = await dg.getOfficeStatus(await ctxFor("ADMIN"));
    expect(s.executors?.find((e) => e.id === state.executorA)?.online).toBe(true);
    expect(s.online).toBe(true);
  });
});

describe("computador do escritório: trabalho de ponta a ponta", () => {
  it("interruptor desligado: não reserva; o pedido fica na fila", async () => {
    await dg.setAiEnabled(await ctxFor("ADMIN"), false, "teste MCP");
    const r = await send("POST", `jobs/${state.runId}/claim`, { token: state.tokenA });
    expect(r.body).toMatchObject({ claimed: false, reason: "DISABLED" });
    await dg.setAiEnabled(await ctxFor("ADMIN"), true, "teste MCP");
  });

  it("fila sem nome do cliente nem título do caso", async () => {
    const r = await send("GET", "jobs", { token: state.tokenA });
    const jobs = (r.body as { jobs: Array<{ id: string }> }).jobs;
    expect(jobs.some((j) => j.id === state.runId)).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain(`Cliente Fictício ${tag}`);
    expect(JSON.stringify(r.body)).not.toContain(`Caso MCP ${tag}`);
  });

  it("reserva exclusiva: A reserva; B não; o contexto traz o agente local e o pedido", async () => {
    const a = await send("POST", `jobs/${state.runId}/claim`, { token: state.tokenA });
    const body = a.body as { claimed: boolean; lease_token: string; context: { agent: { local_agent: string }; input: { request_text: string } } };
    expect(body.claimed).toBe(true);
    expect(body.context.agent.local_agent).toBe("kit-cliente-teste");
    expect(body.context.input.request_text).toBe("Gere a procuração de teste.");
    state.lease = body.lease_token;
    expect((await send("POST", `jobs/${state.runId}/claim`, { token: state.tokenB })).body).toMatchObject({ claimed: false });
  });

  it("escopo: com a reserva lê o caso; outro computador com a mesma reserva, não", async () => {
    const ok = await job("GET", "case");
    expect((ok.body as { id: string }).id).toBe(state.caseId);
    expect((await job("GET", "case", undefined, state.tokenB)).status).toBe(403);
    expect((await job("GET", "case", undefined, state.tokenA, `dgl_${"x".repeat(43)}`)).status).toBe(403);
  });

  it("minuta: envio pela URL assinada, versão INTERNA em revisão; baixar de volta confere o checksum", async () => {
    const pdf = Buffer.from(`%PDF-1.4\n% procuração FICTÍCIA ${tag}\n%%EOF\n`);
    const sha = createHash("sha256").update(pdf).digest("hex");
    const prep = await job("POST", "outputs", { filename: "procuracao-teste.pdf", mime_type: "application/pdf", size: pdf.length });
    expect(prep.status).toBe(200);
    const p = prep.body as { document_id: string; document_version_id: string; storage_object_name: string; upload_url: string };
    const put = await fetch(p.upload_url, { method: "PUT", headers: { "content-type": "application/pdf", "x-upsert": "false" }, body: new Uint8Array(pdf) });
    expect(put.ok).toBe(true);
    const fin = (await job("POST", `outputs/${p.document_version_id}/finalize`, {
      document_id: p.document_id, storage_object_name: p.storage_object_name, filename: "procuracao-teste.pdf", mime_type: "application/pdf",
      size: pdf.length, checksum_sha256: sha, title: "Procuração (teste)", category: "POWER_OF_ATTORNEY",
    })).body as { created: boolean };
    expect(fin.created).toBe(true);
    const { data: d } = await svc.from("documents").select("visibility").eq("id", p.document_id).single();
    expect(d?.visibility).toBe("INTERNAL");

    const docs = (await job("GET", "documents")).body as { documents: Array<{ version_id: string; checksum_sha256: string }> };
    expect(docs.documents.find((x) => x.version_id === p.document_version_id)?.checksum_sha256).toBe(sha);
    const dl = (await job("POST", `documents/${p.document_version_id}/download`)).body as { url: string; checksum_sha256: string };
    const bytes = Buffer.from(await (await fetch(dl.url)).arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(dl.checksum_sha256);
  });

  it("proposta, andamento e conclusão: aguardando decisão humana; linha do tempo completa", async () => {
    const prop = await job("POST", "proposals", { type: "OTHER", summary: "Conferir o endereço do cliente", data: { description: "Confirmar o endereço antes de imprimir." } });
    expect(prop.body).toMatchObject({ created: true });
    expect((await job("POST", "heartbeat", { progress: "Gerando a procuração" })).body).toMatchObject({ ok: true, cancel_requested: false });
    expect((await job("POST", "complete", { report: { client_version: "dg-executor/teste", mode: "ASSISTED" } })).body).toMatchObject({ status: "WAITING_HUMAN" });
    const d = await agents.getAgentRunDetail(await ctxFor("LAWYER"), state.runId);
    expect(d.executorName).toBe(`Computador A ${tag}`);
    const kinds = new Set(d.events.map((e) => e.kind));
    for (const k of ["STATUS", "LEASE", "DOCUMENT_OPENED", "OUTPUT", "PROGRESS"]) expect(kinds.has(k), k).toBe(true);
    expect((await job("GET", "case")).status).toBe(403);
  });

  it("revogar: o token para de valer na hora", async () => {
    await dg.revokeExecutor(await ctxFor("ADMIN"), state.executorB);
    expect((await send("GET", "me", { token: state.tokenB })).status).toBe(403);
  });
});
