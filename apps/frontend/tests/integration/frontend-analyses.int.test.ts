import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as analyses from "@/server/domain/analyses/service";
import { sendAnalysisToAgentSchema, startAnalysisSchema } from "@/server/domain/analyses/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3, Fase E — início ATÔMICO de análise (migration 029) no Supabase
 * DEV real, pelo service (o mesmo caminho das Server Actions):
 * análise + execução + fila numa transação, idempotente pela chave; falha no
 * envio não deixa análise nem execução; reenvio com outra chave recusado.
 *
 * Agente e template FICTÍCIOS (service role, só no setup). Nenhuma execução
 * roda: as que ficarem na fila são canceladas depois de cada teste.
 */

const svc = serviceDb();
let caseId = "";
let agentId = "";
let templateWithAgent = "";
let templateWithoutAgent = "";

async function partnerACase(): Promise<string> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Análise 029" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso análise 029", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

const counts = async () => {
  const [a, r] = await Promise.all([
    svc.from("legal_analyses").select("id", { count: "exact", head: true }).eq("legal_case_id", caseId),
    svc.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", agentId),
  ]);
  return { analyses: a.count ?? 0, runs: r.count ?? 0 };
};

const start = (over: Record<string, unknown> = {}) =>
  startAnalysisSchema.parse({ idempotencyKey: randomUUID(), legalCaseId: caseId, templateId: templateWithAgent, fields: {}, ...over });

beforeAll(async () => {
  const agent = await svc
    .from("agents")
    .insert({ slug: `analise-029-${world.run}`, name: `Agente 029 ${world.run}`, description: "Teste de integração — não executar.", status: "DRAFT" })
    .select("id")
    .single();
  if (agent.error) throw new Error(`agente: ${agent.error.message}`);
  agentId = agent.data.id;
  const version = await svc.from("agent_versions").insert({ agent_id: agentId, instructions: "Agente fictício. Não executar." }).select("id").single();
  if (version.error) throw new Error(`versão: ${version.error.message}`);
  const activated = await svc.from("agents").update({ current_version_id: version.data.id, status: "ACTIVE" }).eq("id", agentId);
  if (activated.error) throw new Error(`ativar: ${activated.error.message}`);
  const tpl = await svc
    .from("analysis_templates")
    .insert({ legal_area_id: world.bankingAreaId, name: `Template 029 ${world.run}`, primary_agent_id: agentId })
    .select("id")
    .single();
  if (tpl.error) throw new Error(`template: ${tpl.error.message}`);
  templateWithAgent = tpl.data.id;
  const seeded = await svc.from("analysis_templates").select("id, primary_agent_id").eq("legal_area_id", world.bankingAreaId).eq("name", "Análise Bancária").single();
  if (seeded.error || !seeded.data) throw new Error("template Análise Bancária não encontrado");
  if (seeded.data.primary_agent_id) throw new Error("o template do seed ganhou agente: o cenário 'sem agente' precisa de outro template");
  templateWithoutAgent = seeded.data.id;
  caseId = await partnerACase();
});

afterEach(async () => {
  await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("agent_id", agentId).eq("status", "QUEUED");
});

afterAll(async () => {
  await svc.from("analysis_templates").update({ active: false }).eq("id", templateWithAgent);
  await svc.from("agents").update({ status: "INACTIVE" }).eq("id", agentId);
});

describe("início atômico (start_legal_analysis_once, 029)", () => {
  it("criar e enviar: análise QUEUED ligada a UMA execução; mesma chave devolve o mesmo par", async () => {
    const lawyer = await ctxFor("LAWYER");
    const before = await counts();
    const input = start({ send: true, requestText: "Conferir descontos (fictício)." });
    const first = await analyses.startAnalysis(lawyer, input);
    const [again, concurrent] = await Promise.all([analyses.startAnalysis(lawyer, input), analyses.startAnalysis(lawyer, input)]);
    expect(first.deduplicated).toBe(false);
    for (const r of [again, concurrent]) expect(r).toMatchObject({ id: first.id, agentRunId: first.agentRunId, deduplicated: true });
    const after = await counts();
    expect([after.analyses - before.analyses, after.runs - before.runs]).toEqual([1, 1]);
    const { data } = await svc.from("legal_analyses").select("status, agent_run_id, started_by").eq("id", first.id).single();
    expect(data).toEqual({ status: "QUEUED", agent_run_id: first.agentRunId, started_by: world.users.LAWYER.id });
    const { data: input2 } = await svc.from("agent_run_inputs").select("parameters").eq("agent_run_id", first.agentRunId).single();
    expect(Object.keys(input2?.parameters ?? {})).toEqual(["request_id"]);
  });

  it("template sem agente: enviar é recusado e NADA é gravado (nem análise, nem execução)", async () => {
    const before = await counts();
    await expectDomainError(analyses.startAnalysis(await ctxFor("LAWYER"), start({ templateId: templateWithoutAgent, send: true })), "BUSINESS_RULE");
    expect(await counts()).toEqual(before);
  });

  it("mesma chave com outros campos = conflito", async () => {
    const lawyer = await ctxFor("LAWYER");
    const key = randomUUID();
    await analyses.startAnalysis(lawyer, start({ idempotencyKey: key }));
    await expectDomainError(analyses.startAnalysis(lawyer, start({ idempotencyKey: key, send: true })), "CONFLICT");
  });

  it("ASSISTANT e parceiro não iniciam análise", async () => {
    await expectDomainError(analyses.startAnalysis(await ctxFor("ASSISTANT"), start()), "FORBIDDEN");
    await expectDomainError(analyses.startAnalysis(await ctxFor("PARTNER_ADMIN_A"), start()), "FORBIDDEN");
  });
});

describe("envio de análise existente (send_legal_analysis_once, 029)", () => {
  it("cria sem enviar e envia depois: uma execução; outra chave com a análise na fila é recusada", async () => {
    const lawyer = await ctxFor("LAWYER");
    const created = await analyses.startAnalysis(lawyer, start());
    expect(created.agentRunId).toBeUndefined();
    const before = await counts();
    const send = sendAnalysisToAgentSchema.parse({ analysisId: created.id, idempotencyKey: randomUUID() });
    const [a, b] = await Promise.all([analyses.sendAnalysisToAgent(lawyer, send), analyses.sendAnalysisToAgent(lawyer, send)]);
    expect(a.agentRunId).toBe(b.agentRunId);
    expect((await counts()).runs - before.runs).toBe(1);
    await expectDomainError(analyses.sendAnalysisToAgent(await ctxFor("ADMIN"), { ...send, idempotencyKey: randomUUID() }), "INVALID_STATE");
    const { data } = await svc.from("legal_analyses").select("status, agent_run_id").eq("id", created.id).single();
    expect(data).toEqual({ status: "QUEUED", agent_run_id: a.agentRunId });
  });
});

describe("assistente (getAnalysisSetup)", () => {
  it("templates ativos da área do caso, com agente e checklist do tipo de cliente", async () => {
    const setup = await analyses.getAnalysisSetup(await ctxFor("LAWYER"), caseId);
    const withAgent = setup.templates.find((t) => t.id === templateWithAgent);
    const seeded = setup.templates.find((t) => t.id === templateWithoutAgent);
    expect(withAgent?.hasAgent).toBe(true);
    expect(seeded?.hasAgent).toBe(false);
    expect(seeded?.requirements.filter((r) => r.required).map((r) => r.category)).toEqual(["IDENTIFICATION", "ADDRESS_PROOF", "BENEFIT_STATEMENT"]);
    expect(seeded?.requirements.every((r) => r.satisfied === false)).toBe(true);
    await expectDomainError(analyses.getAnalysisSetup(await ctxFor("ASSISTANT"), caseId), "FORBIDDEN");
  });
});
