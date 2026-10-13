import { describe, expect, it } from "vitest";
import {
  assignPayload,
  decisionFromRow,
  decisionToDb,
  documentVersionTargetFromRow,
  listItemFromRow,
  proposalTargetFromRow,
  requiresAdminDecision,
  statusFilterToDb,
  targetOf,
  type ReviewRow,
} from "./mappers";
import { assignReviewSchema, decideReviewSchema, listReviewsSchema } from "./schemas";

const ID = "00000000-0000-4000-8000-0000000000a1";

const row = (over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: "rv1",
  legal_case_id: "c1",
  legal_process_id: null,
  document_version_id: null,
  legal_analysis_id: "an1",
  agent_proposal_id: null,
  status: "PENDING",
  priority: "NORMAL",
  assigned_reviewer_id: null,
  due_at: null,
  created_at: "2026-10-12T10:00:00Z",
  updated_at: "2026-10-12T10:00:00Z",
  decided_at: null,
  agent_proposals: null,
  ...over,
});

describe("decisão e status (front ↔ banco)", () => {
  it("decisão do front vira o imperativo do banco", () => {
    expect(decisionToDb("APPROVED")).toBe("APPROVE");
    expect(decisionToDb("CHANGES_REQUESTED")).toBe("REQUEST_CHANGES");
    expect(decisionToDb("REJECTED")).toBe("REJECT");
  });

  it("decisão do banco volta ao front; REOPEN é histórico (null)", () => {
    const base = { id: "d1", notes: null, decided_by: "u1", created_at: "2026-10-12T10:00:00Z" };
    expect(decisionFromRow({ ...base, decision: "APPROVE" }).decision).toBe("APPROVED");
    expect(decisionFromRow({ ...base, decision: "REOPEN" })).toMatchObject({ decision: null, dbDecision: "REOPEN" });
  });

  it("PENDING + prioridade URGENT aparece como URGENT; decidido mantém o status", () => {
    expect(listItemFromRow(row({ priority: "URGENT" }))).toMatchObject({ status: "URGENT", dbStatus: "PENDING", priority: "URGENT" });
    expect(listItemFromRow(row({ status: "APPROVED", priority: "URGENT" })).status).toBe("APPROVED");
  });

  it("filtro OPEN = PENDING + REOPENED", () => {
    expect(statusFilterToDb("OPEN")).toEqual(["PENDING", "REOPENED"]);
    expect(statusFilterToDb("REJECTED")).toEqual(["REJECTED"]);
    expect(statusFilterToDb(undefined)).toBeUndefined();
  });
});

describe("alvo e proposta estrutural", () => {
  it("identifica o alvo único", () => {
    expect(targetOf(row())).toEqual({ kind: "ANALYSIS", id: "an1" });
    expect(targetOf(row({ legal_analysis_id: null, document_version_id: "v1" }))).toEqual({ kind: "DOCUMENT_VERSION", id: "v1" });
    expect(targetOf(row({ legal_analysis_id: null, agent_proposal_id: "p1" }))).toEqual({ kind: "AGENT_PROPOSAL", id: "p1" });
  });

  it("espelha private.proposal_requires_admin", () => {
    for (const t of ["UPDATE_AGENT", "UPDATE_SKILL", "UPDATE_THESIS", "UPDATE_REFERENCE", "ADMIN_ALGO"]) expect(requiresAdminDecision(t)).toBe(true);
    for (const t of ["CREATE_DEADLINE", "REQUEST_DOCUMENT", "UPDATE_CASE", "CREATE_PROCESS", "OTHER", null]) expect(requiresAdminDecision(t)).toBe(false);
    const item = listItemFromRow(row({ legal_analysis_id: null, legal_case_id: null, agent_proposal_id: "p1", agent_proposals: [{ proposal_type: "UPDATE_AGENT" }] }));
    expect(item).toMatchObject({ targetKind: "AGENT_PROPOSAL", proposalType: "UPDATE_AGENT", requiresAdmin: true });
  });

  it("alvos montados a partir da linha da entidade", () => {
    expect(documentVersionTargetFromRow({ id: "v1", document_id: "d1", version_number: 2, original_filename: null, mime_type: null, source: "AGENT", created_at: "x", documents: null })).toBeNull();
    expect(proposalTargetFromRow({ id: "p1", agent_run_id: "r1", proposal_type: "OTHER", status: "PENDING", payload: "texto", requires_human_review: true, created_at: "x" })).toMatchObject({ payload: {} });
  });
});

describe("atribuição: só colunas com grant", () => {
  it("nunca inclui status/decided_at, mesmo que venham no input", () => {
    const parsed = assignReviewSchema.parse({ id: ID, priority: "HIGH", assignedReviewerId: null, status: "APPROVED", decided_at: "2026-01-01" });
    const payload = assignPayload(parsed);
    expect(payload).toEqual({ priority: "HIGH", assigned_reviewer_id: null });
    expect(Object.keys(payload).every((k) => ["assigned_reviewer_id", "priority", "due_at"].includes(k))).toBe(true);
  });

  it("recusa atribuição vazia", () => {
    expect(assignReviewSchema.safeParse({ id: ID }).success).toBe(false);
  });
});

describe("schemas", () => {
  it("rejeitar e pedir alterações exigem justificativa; aprovar não", () => {
    expect(decideReviewSchema.safeParse({ id: ID, decision: "REJECTED" }).success).toBe(false);
    expect(decideReviewSchema.safeParse({ id: ID, decision: "CHANGES_REQUESTED", notes: "  " }).success).toBe(false);
    expect(decideReviewSchema.safeParse({ id: ID, decision: "APPROVED" }).success).toBe(true);
    expect(decideReviewSchema.safeParse({ id: ID, decision: "APPROVE" }).success).toBe(false);
  });

  it("listagem: filtros e ordenação por whitelist", () => {
    expect(listReviewsSchema.parse({ assignee: "me", status: "OPEN" })).toMatchObject({ assignee: "me", status: "OPEN", column: "created_at" });
    expect(listReviewsSchema.safeParse({ assignee: "todos" }).success).toBe(false);
    expect(listReviewsSchema.safeParse({ sortBy: "status" }).success).toBe(false);
  });
});
