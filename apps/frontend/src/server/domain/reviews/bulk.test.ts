import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import {
  BULK_APPROVABLE_PROPOSAL_TYPES,
  bulkBlock,
  bulkBlockMessage,
  bulkSelectable,
  canRequestChanges,
  MAX_BULK_REVIEWS,
  planBulkDecision,
  PROPOSAL_CHANGES_MESSAGE,
  type BulkCandidate,
} from "./bulk-rules";
import { groupFromRow, listItemFromRow, PROPOSAL_DETAIL_MAX, proposalDetail, proposalSendsToPartner, type ReviewGroupRow, type ReviewRow } from "./mappers";
import { decideReviewsBulkSchema, listReviewGroupsSchema, listReviewsSchema } from "./schemas";

// Nada chega ao banco: o repositório é simulado. A regra testada é a do service.
vi.mock("./repository", () => ({
  getById: vi.fn(),
  listByIds: vi.fn(),
  decide: vi.fn(),
  list: vi.fn(),
  listGroups: vi.fn(),
}));

const repo = await import("./repository");
const { filtersToRpc } = await vi.importActual<typeof import("./repository")>("./repository");
const { decideReview, decideReviewsBulk, listReviewGroups, listReviews } = await import("./service");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = id(900);

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: id(999),
    session: { userId: USER, organizationId: id(901), role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const row = (n: number, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: id(n),
  legal_case_id: id(500),
  legal_process_id: null,
  document_version_id: null,
  legal_analysis_id: null,
  agent_proposal_id: id(700 + n),
  agent_run_id: id(600),
  status: "PENDING",
  priority: "NORMAL",
  assigned_reviewer_id: null,
  due_at: null,
  created_at: "2026-11-13T10:00:00Z",
  updated_at: "2026-11-13T10:00:00Z",
  decided_at: null,
  agent_proposals: { proposal_type: "REQUEST_DOCUMENT", payload: { summary: "Pedir o extrato", data: { label: `Extrato ${n}` } } },
  ...over,
});
const proposal = (n: number, type: string, over: Partial<ReviewRow> = {}) => row(n, { agent_proposals: { proposal_type: type, payload: { summary: `Resumo ${n}`, data: {} } }, ...over });
const documentRow = (n: number) => row(n, { agent_proposal_id: null, agent_proposals: null, document_version_id: id(800 + n), document_versions: { version_number: 1, documents: { title: "Minuta" } } });
const analysisRow = (n: number) => row(n, { agent_proposal_id: null, agent_proposals: null, legal_analysis_id: id(850 + n), legal_analyses: { analysis_templates: { name: "Análise Bancária" } } });

const candidate = (over: Partial<BulkCandidate> = {}): BulkCandidate => ({ targetKind: "AGENT_PROPOSAL", proposalType: "REQUEST_DOCUMENT", requiresAdmin: false, dbStatus: "PENDING", ...over });

beforeEach(() => {
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ */
/* Regras (puras)                                                      */
/* ------------------------------------------------------------------ */

describe("decisão em conjunto — o que pode entrar", () => {
  it("aprovar em conjunto: só pedido de documento e proposta sem efeito automático", () => {
    expect(BULK_APPROVABLE_PROPOSAL_TYPES).toEqual(["REQUEST_DOCUMENT", "OTHER"]);
    expect(bulkBlock(candidate(), "APPROVED", false)).toBeNull();
    expect(bulkBlock(candidate({ proposalType: "OTHER" }), "APPROVED", false)).toBeNull();
    for (const type of ["CREATE_DEADLINE", "CREATE_PROCESS", "UPDATE_CASE", "TIPO_NOVO", undefined]) {
      expect(bulkBlock(candidate({ proposalType: type }), "APPROVED", true)).toBe("NEEDS_OPENING");
    }
  });
  it("pedido de documento com mensagem ao parceiro: abre para ler antes de aprovar; rejeitar em conjunto pode", () => {
    const toPartner = candidate({ sendsToPartner: true });
    expect(bulkBlock(toPartner, "APPROVED", true)).toBe("PARTNER_MESSAGE");
    expect(bulkBlock(toPartner, "REJECTED", false)).toBeNull();
    expect(bulkBlockMessage("PARTNER_MESSAGE", toPartner)).toBe("Leva mensagem ao parceiro: abra para ler antes de aprovar.");
    expect(proposalSendsToPartner("REQUEST_DOCUMENT", { summary: "x", data: { label: "RG", message_to_partner: "Favor enviar o RG." } })).toBe(true);
    expect(proposalSendsToPartner("REQUEST_DOCUMENT", { summary: "x", data: { label: "RG", message_to_partner: "   " } })).toBe(false);
    expect(proposalSendsToPartner("REQUEST_DOCUMENT", { summary: "x", data: { label: "RG" } })).toBe(false);
    expect(proposalSendsToPartner("OTHER", { data: { message_to_partner: "x" } })).toBe(false);
    expect(proposalSendsToPartner("REQUEST_DOCUMENT", null)).toBe(false);
    const item = listItemFromRow(row(1, { agent_proposals: { proposal_type: "REQUEST_DOCUMENT", payload: { summary: "x", data: { label: "RG", message_to_partner: "Favor enviar." } } } }));
    expect(item.sendsToPartner).toBe(true);
    expect(listItemFromRow(row(1)).sendsToPartner).toBeUndefined();
  });
  it("documento (minuta) e análise nunca entram, nem para rejeitar: exigem abrir e ler", () => {
    for (const decision of ["APPROVED", "REJECTED"] as const) {
      expect(bulkBlock(candidate({ targetKind: "DOCUMENT_VERSION", proposalType: undefined }), decision, true)).toBe("DOCUMENT");
      expect(bulkBlock(candidate({ targetKind: "ANALYSIS", proposalType: undefined }), decision, true)).toBe("ANALYSIS");
    }
  });
  it("proposta estrutural: quem não é ADMIN não decide; ADMIN rejeita em conjunto, mas para aprovar abre", () => {
    const structural = candidate({ proposalType: "UPDATE_AGENT", requiresAdmin: true });
    expect(bulkBlock(structural, "REJECTED", false)).toBe("ADMIN_ONLY");
    expect(bulkBlock(structural, "APPROVED", false)).toBe("ADMIN_ONLY");
    expect(bulkBlock(structural, "REJECTED", true)).toBeNull();
    expect(bulkBlock(structural, "APPROVED", true)).toBe("NEEDS_OPENING");
  });
  it("rejeitar em conjunto vale para qualquer proposta que a pessoa decide; item já decidido fica de fora", () => {
    expect(bulkBlock(candidate({ proposalType: "CREATE_DEADLINE" }), "REJECTED", false)).toBeNull();
    expect(bulkBlock(candidate({ dbStatus: "REOPENED" }), "APPROVED", false)).toBeNull();
    for (const status of ["APPROVED", "REJECTED", "CHANGES_REQUESTED"]) expect(bulkBlock(candidate({ dbStatus: status }), "REJECTED", true)).toBe("DECIDED");
  });
  it("marcar na tela: só o que entra em pelo menos uma decisão; a explicação cita o tipo da proposta", () => {
    expect(bulkSelectable(candidate({ proposalType: "CREATE_DEADLINE" }), false)).toBe(true);
    expect(bulkSelectable(candidate({ targetKind: "DOCUMENT_VERSION" }), true)).toBe(false);
    expect(bulkSelectable(candidate({ requiresAdmin: true }), false)).toBe(false);
    expect(bulkBlockMessage("NEEDS_OPENING", { proposalType: "CREATE_DEADLINE" })).toBe("Proposta de prazo: abra para conferir antes de aprovar.");
    expect(bulkBlockMessage("NEEDS_OPENING", { proposalType: "TIPO_NOVO" })).toBe("Esta proposta: abra para conferir antes de aprovar.");
    expect(bulkBlockMessage("DOCUMENT", {})).toBe("Documento: abra para ler e decidir.");
    expect(bulkBlockMessage("ADMIN_ONLY", {})).toBe("Só um administrador decide esta proposta.");
  });
  it("'solicitar alterações' vale para documento e análise, não para proposta", () => {
    expect(canRequestChanges("DOCUMENT_VERSION")).toBe(true);
    expect(canRequestChanges("ANALYSIS")).toBe(true);
    expect(canRequestChanges("AGENT_PROPOSAL")).toBe(false);
  });
  it("plano: na ordem pedida, sem repetir; o que não veio do banco fica de fora como não encontrado", () => {
    const found = [listItemFromRow(row(2)), listItemFromRow(documentRow(1))];
    const plan = planBulkDecision([id(1), id(2), id(1), id(3)], found, "APPROVED", false);
    expect(plan.map((s) => [s.item.id, s.outcome, s.item.reason])).toEqual([
      [id(1), "SKIP", "DOCUMENT"],
      [id(2), "DECIDE", undefined],
      [id(3), "SKIP", "NOT_FOUND"],
    ]);
    expect(plan[0].item).toMatchObject({ outcome: "SKIPPED", subject: "Minuta (v1)", message: "Documento: abra para ler e decidir." });
    expect(plan[2].item).toEqual({ id: id(3), outcome: "SKIPPED", reason: "NOT_FOUND", message: "Revisão não encontrada." });
  });
});

describe("entrada das ações (schemas)", () => {
  it("decisão em conjunto: só aprovar ou rejeitar; rejeitar exige justificativa; de 1 a 50 itens", () => {
    expect(decideReviewsBulkSchema.safeParse({ ids: [id(1)], decision: "APPROVED" }).success).toBe(true);
    expect(decideReviewsBulkSchema.safeParse({ ids: [id(1)], decision: "REJECTED" }).success).toBe(false);
    expect(decideReviewsBulkSchema.safeParse({ ids: [id(1)], decision: "REJECTED", notes: "Já está na pasta" }).success).toBe(true);
    expect(decideReviewsBulkSchema.safeParse({ ids: [id(1)], decision: "CHANGES_REQUESTED", notes: "x" }).success).toBe(false);
    expect(decideReviewsBulkSchema.safeParse({ ids: [], decision: "APPROVED" }).success).toBe(false);
    expect(decideReviewsBulkSchema.safeParse({ ids: ["não é id"], decision: "APPROVED" }).success).toBe(false);
    const many = Array.from({ length: MAX_BULK_REVIEWS + 1 }, (_, i) => id(i + 1));
    expect(decideReviewsBulkSchema.safeParse({ ids: many, decision: "APPROVED" }).success).toBe(false);
    expect(decideReviewsBulkSchema.safeParse({ ids: many.slice(0, MAX_BULK_REVIEWS), decision: "APPROVED" }).success).toBe(true);
  });
  it("grupos: mesmos filtros da lista, com busca; ordem padrão = mais antigos primeiro", () => {
    const parsed = listReviewGroupsSchema.parse({ status: "OPEN", priority: ["URGENT", "HIGH"], search: "  maria  " });
    expect(parsed).toMatchObject({ status: "OPEN", priority: ["URGENT", "HIGH"], search: "maria", sortDirection: "asc", page: 1, pageSize: 25 });
    expect(listReviewGroupsSchema.safeParse({ search: "x".repeat(121) }).success).toBe(false);
  });
  it("lista: itens de um grupo (execução OU caso, nunca os dois) e busca", () => {
    expect(listReviewsSchema.parse({ groupRunId: id(600), search: "extrato" })).toMatchObject({ groupRunId: id(600), search: "extrato" });
    expect(listReviewsSchema.safeParse({ groupCaseId: id(500) }).success).toBe(true);
    expect(listReviewsSchema.safeParse({ groupRunId: id(600), groupCaseId: id(500) }).success).toBe(false);
  });
});

describe("leitura — grupo, execução e descrição da proposta", () => {
  it("o item traz a execução do agente e, na proposta, o que ela pede em uma linha", () => {
    expect(listItemFromRow(row(1))).toMatchObject({ agentRunId: id(600), subject: "Pedido de documento", detail: "Extrato 1" });
    expect(listItemFromRow(row(1, { agent_run_id: null })).agentRunId).toBeUndefined();
    expect(listItemFromRow(documentRow(1)).detail).toBeUndefined();
  });
  it("descrição da proposta: documento pedido, depois título, depois resumo; uma linha, com tamanho máximo", () => {
    expect(proposalDetail({ summary: "Resumo", data: { label: "RG", title: "Título" } })).toBe("RG");
    expect(proposalDetail({ summary: "Resumo", data: { title: "Réplica" } })).toBe("Réplica");
    expect(proposalDetail({ summary: "  Ligar para\n a cliente  ", data: {} })).toBe("Ligar para a cliente");
    expect(proposalDetail({ summary: "   " })).toBeUndefined();
    expect(proposalDetail(null)).toBeUndefined();
    expect(proposalDetail("texto")).toBeUndefined();
    const long = proposalDetail({ summary: "a".repeat(500) });
    expect(long).toHaveLength(PROPOSAL_DETAIL_MAX);
    expect(long?.endsWith("…")).toBe(true);
  });
  it("grupo do banco → DTO (nulo vira ausente; números como número)", () => {
    const base: ReviewGroupRow = {
      key: `run:${id(600)}`,
      agent_run_id: id(600),
      legal_case_id: id(500),
      agent_name: "Laura",
      case_title: "Caso X",
      client_name: "Maria Teste",
      total: 21,
      documents: 1,
      proposals: 20,
      analyses: 0,
      open: 21,
      unassigned: 0,
      top_priority: "HIGH",
      first_created_at: "2026-11-13T10:00:00Z",
      last_created_at: "2026-11-13T10:05:00Z",
      reviewer_ids: [USER],
    };
    expect(groupFromRow(base)).toEqual({
      key: `run:${id(600)}`,
      agentRunId: id(600),
      legalCaseId: id(500),
      agentName: "Laura",
      caseTitle: "Caso X",
      clientName: "Maria Teste",
      total: 21,
      documents: 1,
      proposals: 20,
      analyses: 0,
      open: 21,
      unassigned: 0,
      topPriority: "HIGH",
      firstCreatedAt: "2026-11-13T10:00:00Z",
      lastCreatedAt: "2026-11-13T10:05:00Z",
      reviewerIds: [USER],
    });
    const people = groupFromRow({ ...base, key: `case:${id(500)}`, agent_run_id: null, agent_name: null, reviewer_ids: null });
    expect(people).toMatchObject({ key: `case:${id(500)}`, reviewerIds: [] });
    expect(people.agentRunId).toBeUndefined();
    expect(people.agentName).toBeUndefined();
  });
  it("filtros para as funções do banco: só o que foi pedido; busca aparada", () => {
    expect(filtersToRpc({})).toEqual({});
    expect(
      filtersToRpc({
        statuses: ["PENDING", "REOPENED"],
        priorities: ["URGENT"],
        assignee: { kind: "user", id: USER },
        legalCaseId: id(500),
        processId: id(501),
        targetKind: "AGENT_PROPOSAL",
        dueBefore: "2026-11-21T03:00:00.000Z",
        group: { kind: "run", id: id(600) },
        search: "  maria  ",
      }),
    ).toEqual({
      statuses: ["PENDING", "REOPENED"],
      priorities: ["URGENT"],
      assignee: USER,
      legal_case_id: id(500),
      legal_process_id: id(501),
      target_kind: "AGENT_PROPOSAL",
      due_before: "2026-11-21T03:00:00.000Z",
      group_run: id(600),
      search: "maria",
    });
    expect(filtersToRpc({ assignee: { kind: "unassigned" }, group: { kind: "case", id: id(500) }, search: "   " })).toEqual({ unassigned: true, group_case: id(500) });
  });
});

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

describe("decideReviewsBulk — um laço sobre decide_review", () => {
  it("cada item é decidido um a um, na ordem, pela mesma porta; o resultado volta item a item", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([row(2), row(1)]);
    vi.mocked(repo.decide).mockResolvedValueOnce("d1").mockResolvedValueOnce("d2");
    const ctx = ctxOf("LAWYER");
    const out = await decideReviewsBulk(ctx, { ids: [id(1), id(2)], decision: "APPROVED" });
    expect(vi.mocked(repo.decide).mock.calls).toEqual([
      [ctx.db, id(1), "APPROVE", null],
      [ctx.db, id(2), "APPROVE", null],
    ]);
    expect(out).toMatchObject({ decision: "APPROVED", decided: 2, skipped: 0, failed: 0 });
    expect(out.items).toEqual([
      { id: id(1), subject: "Pedido de documento", outcome: "DECIDED" },
      { id: id(2), subject: "Pedido de documento", outcome: "DECIDED" },
    ]);
  });
  it("a falha de um item não desfaz nem interrompe os outros; a mensagem é a segura", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([row(1), row(2), row(3)]);
    vi.mocked(repo.decide)
      .mockResolvedValueOnce("d1")
      .mockRejectedValueOnce(new DomainError("INVALID_STATE", "Revisão em APPROVED não aceita APPROVE"))
      .mockResolvedValueOnce("d3");
    const out = await decideReviewsBulk(ctxOf("ADMIN"), { ids: [id(1), id(2), id(3)], decision: "APPROVED" });
    expect(repo.decide).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ decided: 2, skipped: 0, failed: 1 });
    expect(out.items.map((i) => [i.id, i.outcome, i.message])).toEqual([
      [id(1), "DECIDED", undefined],
      [id(2), "FAILED", "Revisão em APPROVED não aceita APPROVE"],
      [id(3), "DECIDED", undefined],
    ]);
  });
  it("erro inesperado num item vira mensagem genérica (nada técnico sai do servidor)", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([row(1)]);
    vi.mocked(repo.decide).mockRejectedValueOnce(new Error('relation "reviews" does not exist'));
    const out = await decideReviewsBulk(ctxOf("ADMIN"), { ids: [id(1)], decision: "APPROVED" });
    expect(out.items[0]).toMatchObject({ outcome: "FAILED", message: "Não foi possível concluir agora. Tente novamente em instantes." });
  });
  it("aprovar: documento, análise, prazo, proposta estrutural e item decidido ficam de fora, com o motivo, sem chamar o banco", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([
      documentRow(1),
      analysisRow(2),
      proposal(3, "CREATE_DEADLINE"),
      proposal(4, "UPDATE_AGENT"),
      row(5, { status: "APPROVED" }),
      proposal(6, "OTHER"),
    ]);
    vi.mocked(repo.decide).mockResolvedValue("d6");
    const ctx = ctxOf("LAWYER");
    const out = await decideReviewsBulk(ctx, { ids: [1, 2, 3, 4, 5, 6, 7].map(id), decision: "APPROVED" });
    expect(vi.mocked(repo.decide).mock.calls).toEqual([[ctx.db, id(6), "APPROVE", null]]);
    expect(out).toMatchObject({ decided: 1, skipped: 6, failed: 0 });
    expect(out.items.map((i) => [i.outcome, i.reason])).toEqual([
      ["SKIPPED", "DOCUMENT"],
      ["SKIPPED", "ANALYSIS"],
      ["SKIPPED", "NEEDS_OPENING"],
      ["SKIPPED", "ADMIN_ONLY"],
      ["SKIPPED", "DECIDED"],
      ["DECIDED", undefined],
      ["SKIPPED", "NOT_FOUND"],
    ]);
    expect(out.items[2].message).toBe("Proposta de prazo: abra para conferir antes de aprovar.");
    expect(out.items[3].message).toBe("Só um administrador decide esta proposta.");
  });
  it("aprovar: pedido com mensagem ao parceiro fica de fora (o servidor lê o payload, não confia na tela)", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([
      row(1, { agent_proposals: { proposal_type: "REQUEST_DOCUMENT", payload: { summary: "x", data: { label: "RG", message_to_partner: "Favor enviar o RG." } } } }),
      row(2),
    ]);
    vi.mocked(repo.decide).mockResolvedValue("d2");
    const ctx = ctxOf("ADMIN");
    const out = await decideReviewsBulk(ctx, { ids: [id(1), id(2)], decision: "APPROVED" });
    expect(vi.mocked(repo.decide).mock.calls).toEqual([[ctx.db, id(2), "APPROVE", null]]);
    expect(out.items.map((i) => [i.outcome, i.reason])).toEqual([
      ["SKIPPED", "PARTNER_MESSAGE"],
      ["DECIDED", undefined],
    ]);
  });
  it("rejeitar: a justificativa vale para todos; prazo entra; estrutural só com ADMIN; documento nunca", async () => {
    const rows = [proposal(1, "CREATE_DEADLINE"), proposal(2, "UPDATE_SKILL"), documentRow(3)];
    vi.mocked(repo.listByIds).mockResolvedValue(rows);
    vi.mocked(repo.decide).mockResolvedValue("d");
    const lawyer = ctxOf("LAWYER");
    const asLawyer = await decideReviewsBulk(lawyer, { ids: [1, 2, 3].map(id), decision: "REJECTED", notes: "Fora do escopo" });
    expect(vi.mocked(repo.decide).mock.calls).toEqual([[lawyer.db, id(1), "REJECT", "Fora do escopo"]]);
    expect(asLawyer.items.map((i) => i.reason)).toEqual([undefined, "ADMIN_ONLY", "DOCUMENT"]);
    vi.mocked(repo.decide).mockClear();
    const admin = ctxOf("ADMIN");
    const asAdmin = await decideReviewsBulk(admin, { ids: [1, 2, 3].map(id), decision: "REJECTED", notes: "Fora do escopo" });
    expect(vi.mocked(repo.decide).mock.calls).toEqual([
      [admin.db, id(1), "REJECT", "Fora do escopo"],
      [admin.db, id(2), "REJECT", "Fora do escopo"],
    ]);
    expect(asAdmin).toMatchObject({ decided: 2, skipped: 1, failed: 0 });
  });
  it("id repetido é decidido uma vez só", async () => {
    vi.mocked(repo.listByIds).mockResolvedValue([row(1)]);
    vi.mocked(repo.decide).mockResolvedValue("d1");
    const out = await decideReviewsBulk(ctxOf("LAWYER"), { ids: [id(1), id(1), id(1)], decision: "APPROVED" });
    expect(repo.listByIds).toHaveBeenCalledWith(expect.anything(), [id(1)]);
    expect(repo.decide).toHaveBeenCalledTimes(1);
    expect(out.items).toHaveLength(1);
  });
  it("assistente e parceiro não decidem: nada é lido nem gravado", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      await expect(decideReviewsBulk(ctxOf(role), { ids: [id(1)], decision: "APPROVED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(repo.listByIds).not.toHaveBeenCalled();
    expect(repo.decide).not.toHaveBeenCalled();
  });
});

describe("decideReview — proposta só se aprova ou rejeita (067)", () => {
  it("'solicitar alterações' numa proposta é recusado antes de chegar ao banco", async () => {
    vi.mocked(repo.getById).mockResolvedValue(row(1));
    await expect(decideReview(ctxOf("LAWYER"), { id: id(1), decision: "CHANGES_REQUESTED", notes: "Mudar o pedido" })).rejects.toMatchObject({
      code: "INVALID_STATE",
      publicMessage: PROPOSAL_CHANGES_MESSAGE,
    });
    expect(repo.decide).not.toHaveBeenCalled();
  });
  it("documento e análise continuam aceitando 'solicitar alterações'; proposta aceita aprovar e rejeitar", async () => {
    vi.mocked(repo.decide).mockResolvedValue("d");
    const ctx = ctxOf("LAWYER");
    for (const [r, decision, db] of [
      [documentRow(1), "CHANGES_REQUESTED", "REQUEST_CHANGES"],
      [analysisRow(2), "CHANGES_REQUESTED", "REQUEST_CHANGES"],
      [row(3), "REJECTED", "REJECT"],
      [row(4), "APPROVED", "APPROVE"],
    ] as const) {
      vi.mocked(repo.getById).mockResolvedValue(r);
      await decideReview(ctx, { id: r.id, decision, notes: "Justificativa" });
      expect(repo.decide).toHaveBeenLastCalledWith(ctx.db, r.id, db, "Justificativa");
    }
  });
});

describe("fila agrupada e itens de um grupo", () => {
  it("grupos: filtros da tela vão ao banco; 'me' vira o próprio usuário; página com o total de revisões", async () => {
    vi.mocked(repo.listGroups).mockResolvedValue({ rows: [], total: 3, totalItems: 40 });
    const input = listReviewGroupsSchema.parse({ status: "OPEN", assignee: "me", targetKind: "AGENT_PROPOSAL", search: "maria", page: 2, pageSize: 1 });
    const page = await listReviewGroups(ctxOf("LAWYER"), input);
    expect(vi.mocked(repo.listGroups).mock.calls[0].slice(1)).toEqual([
      { statuses: ["PENDING", "REOPENED"], priorities: undefined, assignee: { kind: "user", id: USER }, legalCaseId: undefined, processId: undefined, targetKind: "AGENT_PROPOSAL", dueBefore: undefined, search: "maria" },
      input,
      true,
    ]);
    expect(page).toMatchObject({ total: 3, totalItems: 40, page: 2, pageSize: 1, hasMore: true, items: [] });
    await listReviewGroups(ctxOf("ADMIN"), listReviewGroupsSchema.parse({ sortDirection: "desc" }));
    expect(vi.mocked(repo.listGroups).mock.calls[1][3]).toBe(false);
  });
  it("itens de um grupo: os de uma execução ou, sem execução, os de um caso", async () => {
    vi.mocked(repo.list).mockResolvedValue({ rows: [], total: 0 });
    await listReviews(ctxOf("LAWYER"), listReviewsSchema.parse({ status: "OPEN", groupRunId: id(600) }));
    expect(vi.mocked(repo.list).mock.calls[0][1]).toMatchObject({ group: { kind: "run", id: id(600) }, statuses: ["PENDING", "REOPENED"] });
    await listReviews(ctxOf("LAWYER"), listReviewsSchema.parse({ groupCaseId: id(500), search: "extrato" }));
    expect(vi.mocked(repo.list).mock.calls[1][1]).toMatchObject({ group: { kind: "case", id: id(500) }, search: "extrato" });
    await listReviews(ctxOf("LAWYER"), listReviewsSchema.parse({}));
    expect(vi.mocked(repo.list).mock.calls[2][1].group).toBeUndefined();
  });
  it("assistente e parceiro não leem a fila agrupada", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN"] as const) {
      await expect(listReviewGroups(ctxOf(role), listReviewGroupsSchema.parse({}))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(repo.listGroups).not.toHaveBeenCalled();
  });
});
