import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as analyses from "@/server/domain/analyses/service";
import * as reviews from "@/server/domain/reviews/service";
import { startAnalysisSchema } from "@/server/domain/analyses/schemas";
import { decideReviewSchema, listReviewsSchema } from "@/server/domain/reviews/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Revisões humanas e análises no Supabase DEV real. Gate humano: decisão só
 * por decide_review; UPDATE direto de status é recusado pelo banco; proposta
 * estrutural só ADMIN; ASSISTANT e parceiros sem acesso.
 *
 * Cenário: caso pelo caminho real do parceiro (partner_submit_case); análise
 * pelo service; a revisão da análise é inserida com o JWT do LAWYER (grant de
 * colunas + RLS — caminho de usuário que existe, mas não é operação deste
 * domínio). A proposta estrutural NÃO tem caminho de usuário (execução nasce
 * só por request_agent_run e proposta só pelo worker): agente fictício,
 * execução, proposta e revisão são criados com a service role, só no setup.
 */

let caseId = "";
let templateId = "";

async function partnerACase(): Promise<string> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Revisão" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso revisão", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  return (data as { legal_case_id: string }).legal_case_id;
}

/** Análise nova + revisão aberta dela (uma revisão aberta por alvo). */
async function analysisReview(): Promise<{ analysisId: string; reviewId: string }> {
  const lawyer = await ctxFor("LAWYER");
  const { id: analysisId } = await analyses.startAnalysis(lawyer, startAnalysisSchema.parse({ legalCaseId: caseId, templateId, fields: {} }));
  const reviewId = randomUUID();
  const { error } = await lawyer.db.from("reviews").insert({ id: reviewId, legal_case_id: caseId, legal_analysis_id: analysisId });
  if (error) throw new Error(`revisão: ${error.message}`);
  return { analysisId, reviewId };
}

beforeAll(async () => {
  caseId = await partnerACase();
  const { data, error } = await serviceDb().from("analysis_templates").select("id").eq("legal_area_id", world.bankingAreaId).eq("name", "Análise Bancária").single();
  if (error || !data) throw new Error("template Análise Bancária não encontrado");
  templateId = data.id;
});

describe("análises (básico)", () => {
  it("LAWYER cria; status do front depende dos documentos; sem documentos não vai ao agente", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { id } = await analyses.startAnalysis(lawyer, startAnalysisSchema.parse({ legalCaseId: caseId, templateId, fields: {} }));
    const detail = await analyses.getAnalysis(lawyer, id);
    expect(detail).toMatchObject({ dbStatus: "PENDING", status: "NOT_STARTED", requiredDocumentsComplete: false, legalCaseId: caseId });
    expect(detail.missingRequirements.filter((m) => m.required).map((m) => m.category)).toEqual(["IDENTIFICATION", "ADDRESS_PROOF", "BENEFIT_STATEMENT"]);
    expect(await analyses.getMissingRequirements(lawyer, id)).toEqual(detail.missingRequirements);
    await expectDomainError(analyses.sendAnalysisToAgent(lawyer, { analysisId: id, idempotencyKey: randomUUID() }), "BUSINESS_RULE");
    const { data } = await serviceDb().from("legal_analyses").select("status, started_by").eq("id", id).single();
    expect(data).toMatchObject({ status: "PENDING", started_by: world.users.LAWYER.id });
  });

  it("campo fora do template é recusado; ASSISTANT e parceiro não acessam análises", async () => {
    await expectDomainError(
      analyses.startAnalysis(await ctxFor("LAWYER"), startAnalysisSchema.parse({ legalCaseId: caseId, templateId, fields: { inventado: "x" } })),
      "VALIDATION",
    );
    const input = startAnalysisSchema.parse({ legalCaseId: caseId, templateId, fields: {} });
    await expectDomainError(analyses.startAnalysis(await ctxFor("ASSISTANT"), input), "FORBIDDEN");
    const { analysisId } = await analysisReview();
    await expectDomainError(analyses.getAnalysis(await ctxFor("ASSISTANT"), analysisId), "FORBIDDEN");
    await expectDomainError(analyses.getAnalysis(await ctxFor("PARTNER_ADMIN_A"), analysisId), "FORBIDDEN");
  });
});

describe("revisões — LAWYER decide pelo service (RPC decide_review)", () => {
  it("lista e abre: conteúdo vem do alvo (análise), não da revisão", async () => {
    const { analysisId, reviewId } = await analysisReview();
    const lawyer = await ctxFor("LAWYER");
    const list = await reviews.listReviews(lawyer, listReviewsSchema.parse({ legalCaseId: caseId, status: "OPEN", assignee: "unassigned", pageSize: 50 }));
    expect(list.items.map((r) => r.id)).toContain(reviewId);
    const detail = await reviews.getReview(lawyer, reviewId);
    expect(detail).toMatchObject({ targetKind: "ANALYSIS", targetId: analysisId, status: "PENDING", requiresAdmin: false, decisions: [] });
    expect(detail.target).toMatchObject({ kind: "ANALYSIS", analysisId, analysisStatus: "PENDING", templateId });
  });

  it("atribui (grant de coluna) e só a revisor ADMIN/LAWYER", async () => {
    const { reviewId } = await analysisReview();
    const lawyer = await ctxFor("LAWYER");
    await reviews.assignReview(lawyer, { id: reviewId, assignedReviewerId: world.users.LAWYER.id, priority: "URGENT" });
    const mine = await reviews.listReviews(lawyer, listReviewsSchema.parse({ assignee: "me", pageSize: 50, legalCaseId: caseId }));
    const item = mine.items.find((r) => r.id === reviewId);
    expect(item).toMatchObject({ status: "URGENT", dbStatus: "PENDING", priority: "URGENT", assignedReviewerId: world.users.LAWYER.id });
    await expectDomainError(reviews.assignReview(lawyer, { id: reviewId, assignedReviewerId: world.users.ASSISTANT.id }), "BUSINESS_RULE");
    await expectDomainError(reviews.assignReview(lawyer, { id: reviewId, assignedReviewerId: world.users.PARTNER_ADMIN_A.id }), "BUSINESS_RULE");
  });

  it("pede alterações → reabre → aprova; decisão repetida é recusada; histórico append-only", async () => {
    const { reviewId } = await analysisReview();
    const lawyer = await ctxFor("LAWYER");
    expect(decideReviewSchema.safeParse({ id: reviewId, decision: "CHANGES_REQUESTED" }).success).toBe(false);
    const changes = await reviews.decideReview(lawyer, decideReviewSchema.parse({ id: reviewId, decision: "CHANGES_REQUESTED", notes: "Rever cálculo." }));
    expect(changes.status).toBe("CHANGES_REQUESTED");
    await reviews.reopenReview(lawyer, { id: reviewId, reason: "Cálculo revisto." });
    const approved = await reviews.decideReview(lawyer, decideReviewSchema.parse({ id: reviewId, decision: "APPROVED" }));
    expect(approved.status).toBe("APPROVED");
    await expectDomainError(reviews.decideReview(lawyer, decideReviewSchema.parse({ id: reviewId, decision: "REJECTED", notes: "tarde" })), "INVALID_STATE");

    const detail = await reviews.getReview(lawyer, reviewId);
    expect(detail.decisions.map((d) => d.dbDecision)).toEqual(["REQUEST_CHANGES", "REOPEN", "APPROVE"]);
    expect(detail.decisions.map((d) => d.decision)).toEqual(["CHANGES_REQUESTED", null, "APPROVED"]);
    expect(detail.decidedAt).toBeTruthy();
    const { data } = await serviceDb().from("review_decisions").select("decided_by").eq("review_id", reviewId);
    expect(new Set((data ?? []).map((d) => d.decided_by))).toEqual(new Set([world.users.LAWYER.id]));
  });

  it("bypass: usuário não muda status nem grava decisão direto", async () => {
    const { reviewId } = await analysisReview();
    const db = (await ctxFor("LAWYER")).db;
    expect((await db.from("reviews").update({ status: "APPROVED" }).eq("id", reviewId)).error).not.toBeNull();
    expect((await db.from("reviews").update({ decided_at: new Date().toISOString() }).eq("id", reviewId)).error).not.toBeNull();
    expect((await db.from("review_decisions").insert({ review_id: reviewId, decision: "APPROVE", decided_by: world.users.LAWYER.id })).error).not.toBeNull();
    const { data } = await serviceDb().from("reviews").select("status, decided_at").eq("id", reviewId).single();
    expect(data).toEqual({ status: "PENDING", decided_at: null });
  });
});

describe("revisões — quem não decide", () => {
  it("ASSISTANT: sem acesso (permissão e banco)", async () => {
    const { reviewId } = await analysisReview();
    const assistant = await ctxFor("ASSISTANT");
    await expectDomainError(reviews.listReviews(assistant, listReviewsSchema.parse({})), "FORBIDDEN");
    await expectDomainError(reviews.getReview(assistant, reviewId), "FORBIDDEN");
    await expectDomainError(reviews.decideReview(assistant, decideReviewSchema.parse({ id: reviewId, decision: "APPROVED" })), "FORBIDDEN");
    const { data: visible } = await assistant.db.from("reviews").select("id").eq("id", reviewId);
    expect(visible ?? []).toHaveLength(0);
    const rpc = await assistant.db.rpc("decide_review", { p_review_id: reviewId, p_decision: "APPROVE", p_notes: null });
    expect(rpc.error).not.toBeNull();
  });

  it("parceiro: nunca vê revisão", async () => {
    const { reviewId } = await analysisReview();
    const partner = await ctxFor("PARTNER_ADMIN_A");
    await expectDomainError(reviews.getReview(partner, reviewId), "FORBIDDEN");
    await expectDomainError(reviews.listReviews(partner, listReviewsSchema.parse({})), "FORBIDDEN");
    const { data } = await partner.db.from("reviews").select("id").eq("id", reviewId);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("revisões — proposta estrutural (UPDATE_AGENT) só ADMIN", () => {
  const svc = serviceDb();
  let agentId = "";
  let runId = "";
  let proposalId = "";
  let reviewId = "";

  beforeAll(async () => {
    const agent = await svc
      .from("agents")
      .insert({ slug: `rev-${world.run}`, name: `Agente fictício revisão ${world.run}`, description: "Teste de integração — não executar.", status: "DRAFT" })
      .select("id")
      .single();
    if (agent.error) throw new Error(`agente: ${agent.error.message}`);
    agentId = agent.data.id;
    const version = await svc.from("agent_versions").insert({ agent_id: agentId, instructions: "Agente fictício de teste de integração. Não executar." }).select("id").single();
    if (version.error) throw new Error(`versão: ${version.error.message}`);
    await svc.from("agents").update({ current_version_id: version.data.id, status: "ACTIVE" }).eq("id", agentId);
    // Execução sem mensagem na fila: o worker nunca a recebe.
    const run = await svc.from("agent_runs").insert({ agent_id: agentId, agent_version_id: version.data.id }).select("id").single();
    if (run.error) throw new Error(`execução: ${run.error.message}`);
    runId = run.data.id;
    const proposal = await svc
      .from("agent_proposals")
      .insert({ agent_run_id: runId, proposal_type: "UPDATE_AGENT", payload: { campo: "instrucoes" }, idempotency_key: `teste-${world.run}` })
      .select("id")
      .single();
    if (proposal.error) throw new Error(`proposta: ${proposal.error.message}`);
    proposalId = proposal.data.id;
    reviewId = randomUUID();
    const review = await svc.from("reviews").insert({ id: reviewId, agent_proposal_id: proposalId });
    if (review.error) throw new Error(`revisão: ${review.error.message}`);
  });

  afterAll(async () => {
    await svc.from("agent_runs").update({ status: "CANCELLED" }).eq("id", runId).eq("status", "QUEUED");
    await svc.from("agents").update({ status: "INACTIVE" }).eq("id", agentId);
  });

  it("LAWYER vê, mas não decide (service e banco); ADMIN aprova e a proposta avança", async () => {
    const lawyer = await ctxFor("LAWYER");
    const detail = await reviews.getReview(lawyer, reviewId);
    expect(detail).toMatchObject({ targetKind: "AGENT_PROPOSAL", proposalType: "UPDATE_AGENT", requiresAdmin: true });
    expect(detail.target).toMatchObject({ kind: "AGENT_PROPOSAL", proposalId, payload: { campo: "instrucoes" } });

    await expectDomainError(reviews.decideReview(lawyer, decideReviewSchema.parse({ id: reviewId, decision: "APPROVED" })), "FORBIDDEN");
    const direct = await lawyer.db.rpc("decide_review", { p_review_id: reviewId, p_decision: "APPROVE", p_notes: null });
    expect(direct.error?.code).toBe("42501");
    await expectDomainError(reviews.assignReview(lawyer, { id: reviewId, assignedReviewerId: world.users.LAWYER.id }), "BUSINESS_RULE");

    const admin = await ctxFor("ADMIN");
    expect((await reviews.decideReview(admin, decideReviewSchema.parse({ id: reviewId, decision: "APPROVED" }))).status).toBe("APPROVED");
    const { data } = await svc.from("agent_proposals").select("status").eq("id", proposalId).single();
    expect(data?.status).toBe("APPROVED");
    await expectDomainError(reviews.reopenReview(admin, { id: reviewId }), "INVALID_STATE");
  });
});
