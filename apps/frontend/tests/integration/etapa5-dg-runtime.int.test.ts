import { createHash, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import * as agents from "@/server/domain/agents/service";
import * as dg from "@/server/domain/dg/service";
import { saveAgentSchema, saveReferenceSchema, saveSkillSchema, saveThesisSchema } from "@/server/domain/dg/schemas";
import { configFromDb } from "@/server/domain/dg/mappers";
import { ctxFor, dbFor, expectDomainError, serviceDb, world } from "./support/world";

/**
 * Etapa 5 (migration 039) no Supabase DEV real, pelo service (o caminho das
 * Server Actions): área DG Brasil real (agente, skill com ARQUIVO no Storage,
 * tese, referência, histórico, vínculo de template), interruptor geral da IA,
 * detalhe e nova tentativa de execução. Dados FICTÍCIOS. Nenhuma IA roda.
 */

const svc = serviceDb();
const tag = `e5-${world.run}`;
const created: { agents: string[]; skills: string[]; templates: string[] } = { agents: [], skills: [], templates: [] };

afterAll(async () => {
  // Interruptor volta DESLIGADO (estado seguro do DEV) e nada deste teste fica ativo.
  const admin = await ctxFor("ADMIN");
  await dg.setAiEnabled(admin, false, "fim do teste de integração 5");
  if (created.agents.length) await svc.from("agents").update({ status: "INACTIVE" }).in("id", created.agents);
  if (created.skills.length) await svc.from("skills").update({ status: "DEPRECATED" }).in("id", created.skills);
  if (created.templates.length) await svc.from("analysis_templates").update({ active: false }).in("id", created.templates);
  await svc.from("agent_runs").update({ status: "CANCELLED" }).in("agent_id", created.agents.length ? created.agents : [randomUUID()]).in("status", ["QUEUED"]);
});

describe("interruptor geral da IA (039)", () => {
  it("ADMIN liga e desliga (auditado); LAWYER lê a situação mas não muda", async () => {
    const admin = await ctxFor("ADMIN");
    const on = await dg.setAiEnabled(admin, true, "teste de integração");
    expect(on).toMatchObject({ executionEnabled: true, reason: "teste de integração" });
    const off = await dg.setAiEnabled(admin, false);
    expect(off.executionEnabled).toBe(false);
    const lawyer = await ctxFor("LAWYER");
    expect((await dg.getAiStatus(lawyer)).executionEnabled).toBe(false);
    await expectDomainError(dg.setAiEnabled(lawyer, true), "FORBIDDEN");
    const { data: ev } = await svc.from("audit_events").select("action, actor_user_id").in("action", ["AI_EXECUTION_ENABLED", "AI_EXECUTION_DISABLED"])
      .eq("actor_user_id", world.users.ADMIN.id).order("created_at", { ascending: false }).limit(2);
    expect(ev?.map((e) => e.action).sort()).toEqual(["AI_EXECUTION_DISABLED", "AI_EXECUTION_ENABLED"]);
  });
  it("parceiro não lê a situação", async () => {
    await expectDomainError(dg.getAiStatus(await ctxFor("PARTNER_ADMIN_A")), "FORBIDDEN");
  });
});

describe("área DG Brasil real (039)", () => {
  let skillId = "";
  let agentId = "";

  it("skill com arquivo: URL assinada pelo servidor, upload write-once, versão 1 com o arquivo", async () => {
    const admin = await ctxFor("ADMIN");
    const content = Buffer.from(`print("kit ${tag}")\n`);
    const prepared = await dg.prepareSkillFiles(admin, { files: [{ path: "scripts/gerar.py", size: content.length }] });
    expect(prepared.files[0]!.storageObjectName).toBe(`skills/${prepared.skillId}/${prepared.versionId}/scripts/gerar.py`);
    const up = await dbFor("ADMIN").storage.from(prepared.files[0]!.bucket).uploadToSignedUrl(prepared.files[0]!.storageObjectName, prepared.files[0]!.token, content, { contentType: "text/x-python" });
    expect(up.error).toBeNull();

    const r = await dg.saveSkill(admin, saveSkillSchema.parse({
      key: randomUUID(), id: prepared.skillId, create: true, versionId: prepared.versionId, slug: `kit-${tag}`.slice(0, 60),
      name: `Kit ${tag}`, description: "Gera os documentos do kit (teste).", status: "ACTIVE", instructions: "Rode scripts/gerar.py.",
      files: [{ path: "scripts/gerar.py", storageObjectName: prepared.files[0]!.storageObjectName, mimeType: "text/x-python", size: content.length, sha256: createHash("sha256").update(content).digest("hex") }],
    }));
    expect(r).toMatchObject({ created: true, versionCreated: true, versionNumber: 1 });
    skillId = r.id;
    created.skills.push(skillId);
    const detail = await dg.getSkill(admin, skillId);
    expect(detail.files.map((f) => f.path)).toEqual(["scripts/gerar.py"]);
    expect(detail.providerRegistered).toBe(false);
  });

  it("arquivo que não foi enviado ao Storage é recusado pelo banco", async () => {
    const admin = await ctxFor("ADMIN");
    const prepared = await dg.prepareSkillFiles(admin, { skillId, files: [{ path: "nao-enviado.py", size: 10 }] });
    await expectDomainError(dg.saveSkill(admin, saveSkillSchema.parse({
      key: randomUUID(), id: skillId, create: false, versionId: prepared.versionId, name: `Kit ${tag}`, description: "x", status: "ACTIVE", instructions: "Rode scripts/gerar.py.",
      files: [{ path: "nao-enviado.py", storageObjectName: prepared.files[0]!.storageObjectName, mimeType: "text/x-python", size: 10, sha256: "a".repeat(64) }],
    })), "INVALID_STATE", /não encontrado no Storage/);
  });

  it("LAWYER e ASSISTANT não configuram nada na área DG", async () => {
    for (const role of ["LAWYER", "ASSISTANT"] as const) {
      const ctx = await ctxFor(role);
      await expectDomainError(dg.listAgents(ctx), "FORBIDDEN");
      await expectDomainError(dg.prepareSkillFiles(ctx, { files: [] }), "FORBIDDEN");
    }
  });

  it("agente: cria com versão, skill e configuração; salvar sem mudar o texto não cria versão; mudar cria v2", async () => {
    const admin = await ctxFor("ADMIN");
    const base = {
      name: `Agente ${tag}`, status: "ACTIVE" as const, instructions: "Agente fictício de teste. Não executar.",
      config: { ...configFromDb({}), model: "claude-haiku-5-5" as const, maxBudgetUsd: 0.5 }, skillIds: [skillId], thesisIds: [], referenceIds: [],
    };
    const r = await dg.saveAgent(admin, saveAgentSchema.parse({ key: randomUUID(), ...base }));
    expect(r).toMatchObject({ created: true, versionNumber: 1 });
    agentId = r.id;
    created.agents.push(agentId);
    const same = await dg.saveAgent(admin, saveAgentSchema.parse({ key: randomUUID(), id: agentId, ...base, description: "nova descrição" }));
    expect(same.versionCreated).toBe(false);
    const v2 = await dg.saveAgent(admin, saveAgentSchema.parse({ key: randomUUID(), id: agentId, ...base, instructions: `${base.instructions} Confira o CPF.` }));
    expect(v2).toMatchObject({ versionCreated: true, versionNumber: 2 });
    const detail = await dg.getAgent(admin, agentId);
    expect(detail).toMatchObject({ version: 2, skillIds: [skillId], model: "claude-haiku-5-5", status: "ACTIVE" });
    expect(detail.versions.map((v) => v.number)).toEqual([2, 1]);
    expect((await dg.listAgents(admin)).some((a) => a.id === agentId)).toBe(true);
  });

  it("repetir a mesma chave não duplica (idempotência 027)", async () => {
    const admin = await ctxFor("ADMIN");
    const key = randomUUID();
    const input = saveAgentSchema.parse({ key, name: `Agente dup ${tag}`, status: "DRAFT", instructions: "x", config: configFromDb({}), skillIds: [], thesisIds: [], referenceIds: [] });
    const a = await dg.saveAgent(admin, input);
    const b = await dg.saveAgent(admin, input);
    created.agents.push(a.id);
    expect([b.id, b.deduplicated]).toEqual([a.id, true]);
  });

  it("pausar e ativar; ligar a um modelo de análise", async () => {
    const admin = await ctxFor("ADMIN");
    await dg.setAgentStatus(admin, agentId, "PAUSED");
    expect((await dg.getAgent(admin, agentId)).status).toBe("PAUSED");
    await dg.setAgentStatus(admin, agentId, "ACTIVE");
    const tpl = await svc.from("analysis_templates").insert({ legal_area_id: world.bankingAreaId, name: `Template ${tag}` }).select("id").single();
    created.templates.push(tpl.data!.id);
    await dg.setTemplateAgent(admin, tpl.data!.id, agentId);
    expect((await dg.getAgent(admin, agentId)).templates.map((t) => t.id)).toEqual([tpl.data!.id]);
  });

  it("tese (versionada) e referência de texto; histórico mostra as versões com diferença", async () => {
    const admin = await ctxFor("ADMIN");
    const t = await dg.saveThesis(admin, saveThesisSchema.parse({ key: randomUUID(), title: `Tese ${tag}`, legalAreaId: world.bankingAreaId, status: "ACTIVE", foundations: "Art. 1º", agentIds: [agentId] }));
    expect(t).toMatchObject({ created: true, versionNumber: 1 });
    const t2 = await dg.saveThesis(admin, saveThesisSchema.parse({ key: randomUUID(), id: t.id, title: `Tese ${tag}`, legalAreaId: world.bankingAreaId, status: "ACTIVE", foundations: "Art. 1º e 2º" }));
    expect(t2.versionNumber).toBe(2);
    const refId = randomUUID();
    const ref = await dg.saveReference(admin, saveReferenceSchema.parse({ key: randomUUID(), id: refId, create: true, versionId: randomUUID(), type: "INTERNAL_GUIDELINE", title: `Orientação ${tag}`, status: "ACTIVE", contentText: "Conferir o bloco D.", agentIds: [agentId] }));
    expect(ref.created).toBe(true);
    expect((await dg.listReferences(admin)).find((r) => r.id === refId)).toMatchObject({ hasText: true, agentIds: [agentId] });
    const hist = await dg.history(admin, { limit: 100 });
    const tese = hist.find((h) => h.entityId === t.id && h.version === 2);
    expect(tese?.diff.some((l) => l.type === "added" && l.text.includes("2º"))).toBe(true);
  });
});

describe("execução: detalhe e nova tentativa (039)", () => {
  it("LAWYER vê o detalhe sem uso/custo; tenta de novo uma execução avulsa que falhou (nova execução ligada, idempotente)", async () => {
    const agent = await svc.from("agents").select("id").eq("slug", `kit-${tag}`.slice(0, 60)).maybeSingle();
    void agent;
    const admin = await ctxFor("ADMIN");
    const agentId = created.agents[0]!;
    const caseRow = await dbFor("PARTNER_ADMIN_A").rpc("partner_submit_case", {
      p_client: { document: `999${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Etapa 5" },
      p_case: { legal_area_id: world.bankingAreaId, title: "Caso Etapa 5", origin_organization_id: world.partnerA },
    });
    if (caseRow.error) throw new Error(caseRow.error.message);
    const legalCaseId = (caseRow.data as { legal_case_id: string }).legal_case_id;
    const lawyer = await ctxFor("LAWYER");
    const run = await agents.requestAgentRun(lawyer, { idempotencyKey: randomUUID(), agentId, legalCaseId, requestText: "teste", operation: "EXECUTE" });
    // QUEUED → FAILED (o worker não roda aqui): simula a falha transitória.
    await svc.from("agent_runs").update({ status: "FAILED", error_code: "PROVIDER_UNAVAILABLE", completed_at: new Date().toISOString() }).eq("id", run.runId);

    const d = await agents.getAgentRunDetail(lawyer, run.runId);
    expect(d).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE", legalCaseId });
    expect(d.usage).toBeUndefined();
    expect(d.config).toBeUndefined();
    expect((await agents.getAgentRunDetail(admin, run.runId)).usage).toBeDefined();

    const key = randomUUID();
    const r1 = await agents.retryAgentRun(lawyer, key, run.runId);
    const r2 = await agents.retryAgentRun(lawyer, key, run.runId);
    expect([r1.retryOfId, r2.runId, r2.deduplicated]).toEqual([run.runId, r1.runId, true]);
    expect((await agents.getAgentRunDetail(lawyer, run.runId)).retriedByIds).toEqual([r1.runId]);
    await expectDomainError(agents.retryAgentRun(await ctxFor("ASSISTANT"), randomUUID(), run.runId), "FORBIDDEN");
    await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("id", r1.runId);
  });

  it("uso da IA só para ADMIN", async () => {
    const u = await dg.getAiUsage(await ctxFor("ADMIN"), 30);
    expect(typeof u.totals.runs).toBe("number");
    await expectDomainError(dg.getAiUsage(await ctxFor("LAWYER"), 30), "FORBIDDEN");
  });
});
