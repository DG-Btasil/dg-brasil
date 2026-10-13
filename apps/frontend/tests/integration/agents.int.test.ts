import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as agents from "@/server/domain/agents/service";
import { listAgentRunSummariesSchema, requestAgentRunSchema } from "@/server/domain/agents/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Pedido e acompanhamento de execução de agente no Supabase DEV real.
 * Nada é executado: o agente é FICTÍCIO (criado com a service role, só no
 * setup — agentes são configuração do ADMIN, sem caminho de usuário neste
 * domínio) e toda execução que ficar na fila é CANCELADA logo depois de cada
 * teste, para nenhum worker de DEV pegá-la.
 */

const svc = serviceDb();
let agentId = "";
let caseId = "";

async function partnerACase(): Promise<string> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Agente" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso agente", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

beforeAll(async () => {
  const agent = await svc
    .from("agents")
    .insert({ slug: `run-${world.run}`, name: `Agente fictício ${world.run}`, description: "Teste de integração — não executar.", status: "DRAFT" })
    .select("id")
    .single();
  if (agent.error) throw new Error(`agente: ${agent.error.message}`);
  agentId = agent.data.id;
  const version = await svc.from("agent_versions").insert({ agent_id: agentId, instructions: "Agente fictício de teste de integração. Não executar." }).select("id").single();
  if (version.error) throw new Error(`versão: ${version.error.message}`);
  const activated = await svc.from("agents").update({ current_version_id: version.data.id, status: "ACTIVE" }).eq("id", agentId);
  if (activated.error) throw new Error(`ativar agente: ${activated.error.message}`);
  caseId = await partnerACase();
});

/** Nenhuma execução do agente fictício fica na fila entre um teste e outro. */
afterEach(async () => {
  await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("agent_id", agentId).eq("status", "QUEUED");
});

afterAll(async () => {
  await svc.from("agents").update({ status: "INACTIVE" }).eq("id", agentId);
});

const request = (over: Record<string, unknown> = {}) => requestAgentRunSchema.parse({ agentId, ...over });

describe("pedido de execução (request_agent_run)", () => {
  it("ADMIN pede sem caso; a execução nasce QUEUED com o solicitante e só o correlation ID nos parâmetros", async () => {
    const admin = await ctxFor("ADMIN");
    const { runId, deduplicated } = await agents.requestAgentRun(admin, request({ operation: "ADMIN_CHECK" }));
    expect(deduplicated).toBe(false);
    const { data: run } = await svc.from("agent_runs").select("status, requested_by, legal_case_id, queue_msg_id").eq("id", runId).single();
    expect(run).toMatchObject({ status: "QUEUED", requested_by: world.users.ADMIN.id, legal_case_id: null });
    expect(run?.queue_msg_id).not.toBeNull();
    const { data: input } = await svc.from("agent_run_inputs").select("request_text, parameters").eq("agent_run_id", runId).single();
    expect(input?.request_text).toBeNull();
    expect(Object.keys(input?.parameters ?? {})).toEqual(["request_id"]);
    expect(input?.parameters.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("LAWYER pede com caso; duplo clique devolve a mesma execução", async () => {
    const lawyer = await ctxFor("LAWYER");
    const first = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId, requestText: "Analisar contratos do caso." }));
    const second = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId, requestText: "Analisar contratos do caso." }));
    expect(second).toEqual({ runId: first.runId, deduplicated: true });
    const { count } = await svc.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("legal_case_id", caseId).eq("status", "QUEUED");
    expect(count).toBe(1);
    const { data } = await svc.from("agent_runs").select("requested_by").eq("id", first.runId).single();
    expect(data?.requested_by).toBe(world.users.LAWYER.id);
  });

  it("LAWYER sem caso: recusado no service e no banco", async () => {
    const lawyer = await ctxFor("LAWYER");
    await expectDomainError(agents.requestAgentRun(lawyer, request()), "FORBIDDEN");
    const direct = await lawyer.db.rpc("request_agent_run", { p_agent_id: agentId });
    expect(direct.error?.code).toBe("42501");
  });

  it("ASSISTANT e parceiro: recusados no service e no banco", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN_A", "PARTNER_USER_A"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(agents.requestAgentRun(ctx, request({ legalCaseId: caseId })), "FORBIDDEN");
      const direct = await ctx.db.rpc("request_agent_run", { p_agent_id: agentId, p_legal_case_id: caseId });
      expect(direct.error, role).not.toBeNull();
    }
    const { count } = await svc.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", agentId).in("requested_by", [
      world.users.ASSISTANT.id,
      world.users.PARTNER_ADMIN_A.id,
      world.users.PARTNER_USER_A.id,
    ]);
    expect(count).toBe(0);
  });

  it("agente inexistente: estado inválido, sem execução", async () => {
    await expectDomainError(agents.requestAgentRun(await ctxFor("ADMIN"), requestAgentRunSchema.parse({ agentId: randomUUID() })), "INVALID_STATE");
  });
});

describe("acompanhamento (get_agent_run_summaries)", () => {
  it("LAWYER acompanha SÓ pela RPC; a tabela agent_runs não lhe devolve nada", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { runId } = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId, operation: "SUMMARY_CHECK" }));
    const summaries = await agents.listAgentRunSummaries(lawyer, listAgentRunSummariesSchema.parse({ legalCaseId: caseId }));
    const mine = summaries.find((s) => s.id === runId);
    expect(mine).toMatchObject({ agentId, agentSlug: `run-${world.run}`, legalCaseId: caseId, status: "QUEUED", operation: "SUMMARY_CHECK", proposalCount: 0 });
    for (const field of ["metadata", "inputTokens", "estimatedCost", "model", "errorMessage", "requestText"]) expect(mine).not.toHaveProperty(field);
    const { data } = await lawyer.db.from("agent_runs").select("id").eq("id", runId);
    expect(data ?? []).toHaveLength(0);
  });

  it("ASSISTANT e parceiro não acompanham (service e banco)", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN_A"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(agents.listAgentRunSummaries(ctx, listAgentRunSummariesSchema.parse({})), "FORBIDDEN");
      const direct = await ctx.db.rpc("get_agent_run_summaries", { p_legal_case_id: null, p_limit: 5 });
      expect(direct.error, role).not.toBeNull();
    }
  });
});

describe("cancelamento (ADMIN)", () => {
  it("ADMIN cancela; repetir é estado inválido; LAWYER não cancela", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { runId } = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId, operation: "CANCEL_CHECK" }));
    await expectDomainError(agents.cancelAgentRun(lawyer, runId), "FORBIDDEN");
    const admin = await ctxFor("ADMIN");
    await agents.cancelAgentRun(admin, runId);
    const { data } = await svc.from("agent_runs").select("status").eq("id", runId).single();
    expect(data?.status).toBe("CANCELLED");
    await expectDomainError(agents.cancelAgentRun(admin, runId), "INVALID_STATE");
    await expectDomainError(agents.cancelAgentRun(admin, randomUUID()), "NOT_FOUND");
  });
});
