import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as agents from "@/server/domain/agents/service";
import { listAgentRunsSchema } from "@/server/domain/agents/schemas";
import * as analyses from "@/server/domain/analyses/service";
import { startAnalysisSchema } from "@/server/domain/analyses/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3.1 — "Interromper análise" (migration 033) no Supabase DEV real,
 * pelo service (o caminho das Server Actions). Agente e template FICTÍCIOS
 * (service role, só no setup); nenhuma IA roda. O worker é simulado pela
 * service role (reserva = RUNNING), só para levar a execução ao estado.
 */

const svc = serviceDb();
let agentId = "";
let templateId = "";

async function newCase(): Promise<string> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Interromper 4.3.1" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso interromper 4.3.1", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

async function sentAnalysis(): Promise<{ id: string; runId: string }> {
  const lawyer = await ctxFor("LAWYER");
  const r = await analyses.startAnalysis(lawyer, startAnalysisSchema.parse({ idempotencyKey: randomUUID(), legalCaseId: await newCase(), templateId, fields: {}, send: true }));
  if (!r.agentRunId) throw new Error("análise sem execução");
  return { id: r.id, runId: r.agentRunId };
}

/** Simula o worker reservando a execução (o worker real não roda nesta etapa). */
async function claim(runId: string) {
  const now = new Date().toISOString();
  const { error } = await svc.from("agent_runs").update({ status: "RUNNING", claimed_by: "teste-431", claimed_at: now, started_at: now, heartbeat_at: now }).eq("id", runId);
  if (error) throw new Error(`reserva: ${error.message}`);
}

const runRow = async (id: string) => (await svc.from("agent_runs").select("status, cancel_requested_by").eq("id", id).single()).data;
const analysisStatus = async (id: string) => (await svc.from("legal_analyses").select("status, interruption_reason").eq("id", id).single()).data;

beforeAll(async () => {
  const agent = await svc.from("agents").insert({ slug: `interromper-431-${world.run}`, name: `Agente 4.3.1 ${world.run}`, description: "Teste — não executar.", status: "DRAFT" }).select("id").single();
  if (agent.error) throw new Error(`agente: ${agent.error.message}`);
  agentId = agent.data.id;
  const version = await svc.from("agent_versions").insert({ agent_id: agentId, instructions: "Agente fictício. Não executar." }).select("id").single();
  if (version.error) throw new Error(`versão: ${version.error.message}`);
  await svc.from("agents").update({ current_version_id: version.data.id, status: "ACTIVE" }).eq("id", agentId);
  const tpl = await svc.from("analysis_templates").insert({ legal_area_id: world.bankingAreaId, name: `Template 4.3.1 ${world.run}`, primary_agent_id: agentId }).select("id").single();
  if (tpl.error) throw new Error(`template: ${tpl.error.message}`);
  templateId = tpl.data.id;
});

afterEach(async () => {
  // Nada deste agente fica na fila nem "rodando".
  await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("agent_id", agentId).in("status", ["QUEUED", "RUNNING"]);
});

afterAll(async () => {
  await svc.from("analysis_templates").update({ active: false }).eq("id", templateId);
  await svc.from("agents").update({ status: "INACTIVE" }).eq("id", agentId);
});

describe("interromper análise (033)", () => {
  it("na fila: LAWYER interrompe → para na hora; análise interrompida; repetir é idempotente", async () => {
    const a = await sentAnalysis();
    const lawyer = await ctxFor("LAWYER");
    const r = await analyses.cancelAnalysis(lawyer, a.id);
    expect(r).toMatchObject({ agentRunId: a.runId, outcome: "CANCELLED", status: "CANCELLED" });
    expect(await runRow(a.runId)).toEqual({ status: "CANCELLED", cancel_requested_by: world.users.LAWYER.id });
    expect(await analysisStatus(a.id)).toEqual({ status: "CANCELLED", interruption_reason: "Execução interrompida a pedido." });
    expect((await analyses.cancelAnalysis(lawyer, a.id)).outcome).toBe("ALREADY_CANCELLED");
    const { data: ev } = await svc.from("audit_events").select("actor_user_id").eq("entity_id", a.runId).eq("action", "AGENT_RUN_CANCELLED");
    expect(ev?.map((e) => e.actor_user_id)).toEqual([world.users.LAWYER.id]);
  });

  it("rodando: ADMIN pede → segue RUNNING com 'interrupção solicitada' na análise e na lista; repetir não duplica", async () => {
    const a = await sentAnalysis();
    await claim(a.runId);
    const admin = await ctxFor("ADMIN");
    expect((await agents.cancelAgentRun(admin, a.runId)).outcome).toBe("CANCEL_REQUESTED");
    expect((await runRow(a.runId))?.status).toBe("RUNNING");
    expect((await analyses.getAnalysis(await ctxFor("LAWYER"), a.id)).cancelRequested).toBe(true);
    const runs = await agents.listAgentRuns(admin, listAgentRunsSchema.parse({ agentId, status: "RUNNING" }));
    expect(runs.items.find((r) => r.id === a.runId)?.cancelRequested).toBe(true);
    expect((await agents.cancelAgentRun(await ctxFor("LAWYER"), a.runId)).outcome).toBe("ALREADY_REQUESTED");
    const { data: ev } = await svc.from("audit_events").select("actor_user_id").eq("entity_id", a.runId).eq("action", "AGENT_RUN_CANCEL_REQUESTED");
    expect(ev?.length).toBe(1);
  });

  it("encerrada: recusado; sem permissão: recusado; parceiro: recusado", async () => {
    const a = await sentAnalysis();
    await claim(a.runId);
    await svc.from("agent_runs").update({ status: "COMPLETED", completed_at: new Date().toISOString() }).eq("id", a.runId);
    expect((await analysisStatus(a.id))?.status).toBe("COMPLETED");
    await expectDomainError(agents.cancelAgentRun(await ctxFor("ADMIN"), a.runId), "INVALID_STATE");
    const b = await sentAnalysis();
    await expectDomainError(agents.cancelAgentRun(await ctxFor("ASSISTANT"), b.runId), "FORBIDDEN");
    await expectDomainError(agents.cancelAgentRun(await ctxFor("PARTNER_ADMIN_A"), b.runId), "FORBIDDEN");
    await expectDomainError(agents.cancelAgentRun(await ctxFor("ADMIN"), randomUUID()), "NOT_FOUND");
  });

  it("UPDATE direto de RUNNING para CANCELLED pelo ADMIN não passa mais (só o pedido)", async () => {
    const a = await sentAnalysis();
    await claim(a.runId);
    const { count } = await (await ctxFor("ADMIN")).db.from("agent_runs").update({ status: "CANCELLED" }, { count: "exact" }).eq("id", a.runId);
    expect(count ?? 0).toBe(0);
    expect((await runRow(a.runId))?.status).toBe("RUNNING");
  });
});
