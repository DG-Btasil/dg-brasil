import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/server/core/logger";
import * as agents from "@/server/domain/agents/service";
import * as dg from "@/server/domain/dg/service";
import { saveAgentSchema } from "@/server/domain/dg/schemas";
import * as reviews from "@/server/domain/reviews/service";
import { decideReviewSchema } from "@/server/domain/reviews/schemas";
import { pgExecutorDb } from "@/server/executor/db";
import { handleExecutorRequest, type ExecutorDeps } from "@/server/executor/handler";
import { signedExecutorStorage } from "@/server/executor/storage";
import { integrationEnv } from "./support/env";
import { ctxFor, dbFor, serviceDb, world } from "./support/world";

/**
 * Manutenção no pg_cron REAL do Supabase DEV (migration 040): o que o worker
 * antigo fazia sem IA. Nada é chamado à mão: o teste muda o estado e espera o
 * agendamento "dg-manutencao" (a cada minuto) agir.
 *
 *   - computador que parou de responder: a reserva vence e o trabalho volta à fila;
 *   - proposta aprovada por humano vira fato (pendência no caso);
 *   - execução com tudo decidido fecha como concluída.
 *
 * Dados FICTÍCIOS. Nenhuma IA roda.
 */

integrationEnv();
if (!process.env.DG_WORKER_DB_URL) {
  throw new Error("Falta DG_WORKER_DB_URL em supabase/.env.real (login dg_worker pelo pooler IPv4 do Supabase).");
}

const svc = serviceDb();
const tag = `cron-${world.run}`;
const deps: ExecutorDeps = { db: pgExecutorDb(), storage: signedExecutorStorage(), log: createLogger({ test: "mcp-cron" }) };
const state = { token: "", executorId: "", agentId: "", runId: "", caseId: "", lease: "" };
// Uma volta do pg_cron é de até 60 s; folga para a rodada atrasar.
const CRON_WAIT_MS = 150_000;

function send(method: string, path: string, opts: { lease?: string; body?: unknown } = {}) {
  const headers = new Headers({ authorization: `Bearer ${state.token}` });
  if (opts.lease) headers.set("x-dg-lease", opts.lease);
  return handleExecutorRequest({ method, segments: path.split("/").filter(Boolean), headers, query: new URLSearchParams(), body: opts.body }, deps);
}
const job = (method: string, action: string, body?: unknown, lease = state.lease) => send(method, `jobs/${state.runId}/${action}`, { lease, body });

async function claim() {
  const r = await send("POST", `jobs/${state.runId}/claim`);
  const body = r.body as { claimed: boolean; lease_token: string };
  expect(body.claimed).toBe(true);
  state.lease = body.lease_token;
}

async function waitFor<T>(what: string, read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const until = Date.now() + CRON_WAIT_MS;
  for (;;) {
    const v = await read();
    if (done(v)) return v;
    if (Date.now() > until) throw new Error(`pg_cron não agiu em ${CRON_WAIT_MS / 1000} s: ${what} (${JSON.stringify(v)})`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function runRow() {
  const { data, error } = await svc.from("agent_runs").select("status, error_code, attempt, executor_id").eq("id", state.runId).single();
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  const admin = await ctxFor("ADMIN");
  const e = await dg.createExecutor(admin, `Computador ${tag}`);
  Object.assign(state, { token: e.token, executorId: e.id });
  const agent = await dg.saveAgent(admin, saveAgentSchema.parse({
    key: randomUUID(), name: `Kit ${tag}`, status: "ACTIVE", instructions: "Peça a identidade (teste) com uma proposta.",
    config: { localAgent: "kit-cliente-teste" }, thesisIds: [], referenceIds: [],
  }));
  state.agentId = agent.id;
  const caseRow = await dbFor("PARTNER_ADMIN_A").rpc("partner_submit_case", {
    p_client: { document: `999${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: `Cliente Fictício ${tag}` },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso pg_cron ${tag}`, origin_organization_id: world.partnerA },
  });
  if (caseRow.error) throw new Error(caseRow.error.message);
  state.caseId = (caseRow.data as { legal_case_id: string }).legal_case_id;
  const run = await agents.requestAgentRun(await ctxFor("LAWYER"), {
    idempotencyKey: randomUUID(), agentId: state.agentId, legalCaseId: state.caseId, requestText: "Peça a identidade.", operation: "EXECUTE",
  });
  state.runId = run.runId;
  await dg.setAiEnabled(admin, true, `teste pg_cron ${tag}`);
});

afterAll(async () => {
  const admin = await ctxFor("ADMIN");
  await dg.setAiEnabled(admin, false, "fim do teste de integração pg_cron");
  if (state.executorId) await dg.revokeExecutor(admin, state.executorId).catch(() => undefined);
  if (state.agentId) await svc.from("agents").update({ status: "INACTIVE" }).eq("id", state.agentId);
  if (state.runId) await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("id", state.runId).in("status", ["QUEUED", "RUNNING", "WAITING_HUMAN"]);
});

describe("manutenção no pg_cron real (040)", () => {
  it("computador parou de responder: a reserva vence e o trabalho volta à fila; a reserva antiga não vale mais", async () => {
    await claim();
    const old = state.lease;
    // O computador "caiu": último batimento há 6 minutos (a reserva dura 5).
    const { error } = await svc.from("agent_runs").update({ heartbeat_at: new Date(Date.now() - 6 * 60_000).toISOString() }).eq("id", state.runId);
    expect(error).toBeNull();
    const r = await waitFor("reserva vencida volta à fila", runRow, (x) => x.status !== "RUNNING");
    expect(r).toMatchObject({ status: "QUEUED", error_code: "LEASE_EXPIRED" });
    const d = await agents.getAgentRunDetail(await ctxFor("LAWYER"), state.runId);
    expect(d.events.some((e) => e.kind === "STATUS" && e.from === "RUNNING" && e.to === "QUEUED" && e.message === "LEASE_EXPIRED")).toBe(true);
    expect((await job("GET", "case", undefined, old)).status).toBe(403);
  }, CRON_WAIT_MS + 30_000);

  it("proposta aprovada vira pendência no caso; com tudo decidido a execução conclui", async () => {
    await claim();
    expect((await runRow()).attempt).toBe(2);
    const prop = await job("POST", "proposals", {
      type: "REQUEST_DOCUMENT", summary: "Pedir a identidade do cliente (teste)",
      data: { label: `Identidade ${tag}`, category: "IDENTIFICATION", required: true },
    });
    const proposalId = (prop.body as { proposal_id: string; created: boolean }).proposal_id;
    expect(prop.body).toMatchObject({ created: true });
    expect((await job("POST", "complete", { report: { mode: "ASSISTED" } })).body).toMatchObject({ status: "WAITING_HUMAN" });

    const { data: rv } = await svc.from("reviews").select("id").eq("agent_proposal_id", proposalId).single();
    await reviews.decideReview(await ctxFor("LAWYER"), decideReviewSchema.parse({ id: rv!.id, decision: "APPROVED" }));

    const p = await waitFor("proposta aprovada aplicada", async () => {
      const { data } = await svc.from("agent_proposals").select("status, applied_entity_type, applied_entity_id, application_error").eq("id", proposalId).single();
      return data!;
    }, (x) => x.status !== "APPROVED");
    expect(p).toMatchObject({ status: "APPLIED", application_error: null });
    const { data: req } = await svc.from("case_document_requirements").select("legal_case_id, requirement_label, status").eq("id", p.applied_entity_id).single();
    expect(req).toMatchObject({ legal_case_id: state.caseId, requirement_label: `Identidade ${tag}`, status: "REQUESTED" });

    const r = await waitFor("execução decidida fecha", runRow, (x) => x.status === "COMPLETED");
    expect(r.status).toBe("COMPLETED");
  }, 2 * CRON_WAIT_MS + 30_000);
});
