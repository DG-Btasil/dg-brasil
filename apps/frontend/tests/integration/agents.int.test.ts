import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as agents from "@/server/domain/agents/service";
import { listAgentRunSummariesSchema, requestAgentRunSchema } from "@/server/domain/agents/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Pedido (request_agent_run_once, chave por formulário) e acompanhamento de
 * execução de agente no Supabase DEV real.
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

/** Cada chamada é um formulário novo (chave nova), salvo quando o teste repete a chave de propósito. */
const request = (over: Record<string, unknown> = {}) => requestAgentRunSchema.parse({ idempotencyKey: randomUUID(), agentId, ...over });

describe("pedido de execução (request_agent_run_once)", () => {
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

  it("LAWYER pede com caso; mesma chave (duplo clique/nova tentativa) devolve a mesma execução; chave nova cria outra", async () => {
    const lawyer = await ctxFor("LAWYER");
    const key = randomUUID();
    const first = await agents.requestAgentRun(lawyer, request({ idempotencyKey: key, legalCaseId: caseId, requestText: "Analisar contratos do caso." }));
    expect(first.deduplicated).toBe(false);
    const [again, race] = await Promise.all([
      agents.requestAgentRun(lawyer, request({ idempotencyKey: key, legalCaseId: caseId, requestText: "Analisar contratos do caso." })),
      agents.requestAgentRun(lawyer, request({ idempotencyKey: key, legalCaseId: caseId, requestText: "Analisar contratos do caso." })),
    ]);
    expect(again).toEqual({ runId: first.runId, deduplicated: true });
    expect(race).toEqual({ runId: first.runId, deduplicated: true });
    const { data } = await svc.from("agent_runs").select("requested_by, idempotency_key").eq("id", first.runId).single();
    expect(data).toEqual({ requested_by: world.users.LAWYER.id, idempotency_key: key });
    const { count } = await svc.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", agentId).eq("legal_case_id", caseId).eq("status", "QUEUED");
    expect(count).toBe(1);

    const other = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId }));
    expect(other.deduplicated).toBe(false);
    expect(other.runId).not.toBe(first.runId);
  });

  it("a chave é por solicitante: a mesma chave de outro usuário não devolve a execução alheia", async () => {
    const key = randomUUID();
    const lawyerRun = await agents.requestAgentRun(await ctxFor("LAWYER"), request({ idempotencyKey: key, legalCaseId: caseId }));
    const adminRun = await agents.requestAgentRun(await ctxFor("ADMIN"), request({ idempotencyKey: key, legalCaseId: caseId }));
    expect(adminRun.deduplicated).toBe(false);
    expect(adminRun.runId).not.toBe(lawyerRun.runId);
  });

  it("LAWYER sem caso: recusado no service e no banco", async () => {
    const lawyer = await ctxFor("LAWYER");
    await expectDomainError(agents.requestAgentRun(lawyer, request()), "FORBIDDEN");
    const direct = await lawyer.db.rpc("request_agent_run_once", { p_idempotency_key: randomUUID(), p_agent_id: agentId });
    expect(direct.error?.code).toBe("42501");
  });

  it("ASSISTANT e parceiro: recusados no service e no banco", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN_A", "PARTNER_USER_A"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(agents.requestAgentRun(ctx, request({ legalCaseId: caseId })), "FORBIDDEN");
      const direct = await ctx.db.rpc("request_agent_run_once", { p_idempotency_key: randomUUID(), p_agent_id: agentId, p_legal_case_id: caseId });
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
    await expectDomainError(agents.requestAgentRun(await ctxFor("ADMIN"), requestAgentRunSchema.parse({ idempotencyKey: randomUUID(), agentId: randomUUID() })), "INVALID_STATE");
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

describe("interrupção (033)", () => {
  it("LAWYER do caso interrompe execução na fila; repetir é idempotente; ASSISTANT não; id inventado: não encontrada", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { runId } = await agents.requestAgentRun(lawyer, request({ legalCaseId: caseId, operation: "CANCEL_CHECK" }));
    await expectDomainError(agents.cancelAgentRun(await ctxFor("ASSISTANT"), runId), "FORBIDDEN");
    expect((await agents.cancelAgentRun(lawyer, runId)).outcome).toBe("CANCELLED");
    const { data } = await svc.from("agent_runs").select("status").eq("id", runId).single();
    expect(data?.status).toBe("CANCELLED");
    expect((await agents.cancelAgentRun(await ctxFor("ADMIN"), runId)).outcome).toBe("ALREADY_CANCELLED");
    await expectDomainError(agents.cancelAgentRun(await ctxFor("ADMIN"), randomUUID()), "NOT_FOUND");
  });
});
