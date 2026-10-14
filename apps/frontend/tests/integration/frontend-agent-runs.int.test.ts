import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as agents from "@/server/domain/agents/service";
import { listAgentRunsSchema, requestAgentRunSchema } from "@/server/domain/agents/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3, Fase G — execuções de agente paginadas (migration 031) no
 * Supabase DEV real. Agente FICTÍCIO (service role, só no setup); nada roda:
 * as execuções ficam na fila e são canceladas depois de cada teste.
 */

const svc = serviceDb();
let agentId = "";
let caseId = "";

beforeAll(async () => {
  const agent = await svc.from("agents").insert({ slug: `runs-031-${world.run}`, name: `Agente 031 ${world.run}`, status: "DRAFT" }).select("id").single();
  if (agent.error) throw new Error(`agente: ${agent.error.message}`);
  agentId = agent.data.id;
  const version = await svc.from("agent_versions").insert({ agent_id: agentId, instructions: "Agente fictício. Não executar." }).select("id").single();
  if (version.error) throw new Error(`versão: ${version.error.message}`);
  const on = await svc.from("agents").update({ current_version_id: version.data.id, status: "ACTIVE" }).eq("id", agentId);
  if (on.error) throw new Error(`ativar: ${on.error.message}`);
  const pa = await ctxFor("PARTNER_ADMIN_A");
  const { data, error } = await pa.db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente 031" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso 031", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`caso: ${error.message}`);
  caseId = (data as { legal_case_id: string }).legal_case_id;
});

afterEach(async () => {
  await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("agent_id", agentId).eq("status", "QUEUED");
});

afterAll(async () => {
  await svc.from("agents").update({ status: "INACTIVE" }).eq("id", agentId);
});

describe("lista paginada de execuções (031)", () => {
  it("páginas sem sobreposição, total coerente, filtro por agente, caso e situação", async () => {
    const lawyer = await ctxFor("LAWYER");
    for (let i = 0; i < 3; i++) await agents.requestAgentRun(lawyer, requestAgentRunSchema.parse({ idempotencyKey: randomUUID(), agentId, legalCaseId: caseId }));
    const p1 = await agents.listAgentRuns(lawyer, listAgentRunsSchema.parse({ agentId, page: 1, pageSize: 2 }));
    const p2 = await agents.listAgentRuns(lawyer, listAgentRunsSchema.parse({ agentId, page: 2, pageSize: 2 }));
    expect(p1.total).toBe(3);
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(1);
    expect(p1.items.some((r) => p2.items.some((s) => s.id === r.id))).toBe(false);
    const byCase = await agents.listAgentRuns(lawyer, listAgentRunsSchema.parse({ legalCaseId: caseId, status: "QUEUED" }));
    expect(byCase.items.every((r) => r.legalCaseId === caseId && r.status === "QUEUED")).toBe(true);
    for (const k of ["metadata", "requestText", "model", "estimatedCost", "errorMessage"]) expect(p1.items[0]).not.toHaveProperty(k);
  });

  it("ADMIN vê também execução sem caso; LAWYER nunca", async () => {
    const admin = await ctxFor("ADMIN");
    const { runId } = await agents.requestAgentRun(admin, requestAgentRunSchema.parse({ idempotencyKey: randomUUID(), agentId, operation: "ADMIN_CHECK" }));
    const asAdmin = await agents.listAgentRuns(admin, listAgentRunsSchema.parse({ agentId, pageSize: 50 }));
    expect(asAdmin.items.some((r) => r.id === runId)).toBe(true);
    const asLawyer = await agents.listAgentRuns(await ctxFor("LAWYER"), listAgentRunsSchema.parse({ agentId, pageSize: 50 }));
    expect(asLawyer.items.some((r) => r.id === runId)).toBe(false);
  });

  it("ASSISTANT e parceiros não leem", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN_A", "PARTNER_USER_A"] as const) {
      await expectDomainError(agents.listAgentRuns(await ctxFor(role), listAgentRunsSchema.parse({})), "FORBIDDEN");
    }
  });
});
