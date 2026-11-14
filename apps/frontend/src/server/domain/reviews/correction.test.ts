import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { canCorrectProposal, changedProposalFields, CORRECTABLE_PROPOSAL_TYPES, isCorrectableProposalType, NOTHING_CHANGED_MESSAGE } from "./correction-rules";
import type { ProposalTargetRow, ReviewRow } from "./mappers";
import { proposalTargetFromRow } from "./mappers";
import { correctReviewSchema } from "./schemas";

// Nada chega ao banco: o repositório é simulado. A regra testada é a do service.
vi.mock("./repository", () => ({
  getById: vi.fn(),
  getProposalTarget: vi.fn(),
  correctAndApprove: vi.fn(),
}));

const repo = await import("./repository");
const { correctAndApproveReview } = await import("./service");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REVIEW = id(1);
const PROPOSAL = id(2);
const PROCESS = id(3);
const LAWYER = id(4);

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: id(999),
    session: { userId: id(900), organizationId: id(901), role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const original = { title: "Réplica", due_at: "2027-03-10T23:59:00-03:00", priority: "NORMAL", legal_process_id: PROCESS };

const reviewRow = (over: Partial<ReviewRow> = {}, type = "CREATE_DEADLINE"): ReviewRow => ({
  id: REVIEW,
  legal_case_id: id(500),
  legal_process_id: null,
  document_version_id: null,
  legal_analysis_id: null,
  agent_proposal_id: PROPOSAL,
  agent_run_id: id(600),
  status: "PENDING",
  priority: "NORMAL",
  assigned_reviewer_id: null,
  due_at: null,
  created_at: "2026-11-13T10:00:00Z",
  updated_at: "2026-11-13T10:00:00Z",
  decided_at: null,
  agent_proposals: { proposal_type: type, payload: { summary: "Prazo de réplica", data: original } },
  ...over,
});

const proposalRow = (data: Record<string, unknown> = original, type = "CREATE_DEADLINE"): ProposalTargetRow => ({
  id: PROPOSAL,
  agent_run_id: id(600),
  proposal_type: type,
  status: "PENDING",
  payload: { summary: "Prazo de réplica", data },
  requires_human_review: true,
  created_at: "2026-11-13T10:00:00Z",
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof DomainError ? e.code : "OTHER";
  }
  return "OK";
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.getById).mockResolvedValue(reviewRow());
  vi.mocked(repo.getProposalTarget).mockResolvedValue(proposalRow());
  vi.mocked(repo.correctAndApprove).mockResolvedValue({ decision_id: id(77), fields: ["title"] });
});

describe("regras puras da correção", () => {
  it("só os quatro tipos com efeito automático se corrigem", () => {
    expect(CORRECTABLE_PROPOSAL_TYPES).toEqual(["CREATE_DEADLINE", "REQUEST_DOCUMENT", "UPDATE_CASE", "CREATE_PROCESS"]);
    for (const t of ["OTHER", "UPDATE_AGENT", "UPDATE_SKILL", undefined, null]) expect(isCorrectableProposalType(t)).toBe(false);
  });

  it("corrigir: proposta em aberto, que a pessoa pode decidir", () => {
    const base = { targetKind: "AGENT_PROPOSAL" as const, proposalType: "CREATE_DEADLINE", requiresAdmin: false, dbStatus: "PENDING" };
    expect(canCorrectProposal(base, false)).toBe(true);
    expect(canCorrectProposal({ ...base, dbStatus: "REOPENED" }, false)).toBe(true);
    expect(canCorrectProposal({ ...base, dbStatus: "APPROVED" }, true)).toBe(false);
    expect(canCorrectProposal({ ...base, targetKind: "DOCUMENT_VERSION" }, true)).toBe(false);
    expect(canCorrectProposal({ ...base, proposalType: "OTHER" }, true)).toBe(false);
    expect(canCorrectProposal({ ...base, proposalType: "UPDATE_AGENT", requiresAdmin: true }, true)).toBe(false);
  });

  it("campos que mudaram: chaves novas, tiradas e alteradas, em ordem", () => {
    expect(changedProposalFields(original, { ...original, title: "Outra", description: "x" })).toEqual(["description", "title"]);
    const semPrioridade: Record<string, unknown> = { ...original };
    delete semPrioridade.priority;
    expect(changedProposalFields(original, semPrioridade)).toEqual(["priority"]);
    expect(changedProposalFields(original, { ...original })).toEqual([]);
  });

  it("a entrada exige id e dados em objeto", () => {
    expect(correctReviewSchema.safeParse({ id: REVIEW, data: { title: "x" } }).success).toBe(true);
    expect(correctReviewSchema.safeParse({ id: REVIEW, data: "texto" }).success).toBe(false);
    expect(correctReviewSchema.safeParse({ id: "1", data: {} }).success).toBe(false);
  });

  it("o alvo da proposta traz o original e quem corrigiu, quando houver", () => {
    const t = proposalTargetFromRow({ ...proposalRow(), original_payload: { summary: "s", data: original }, corrected_by: LAWYER, corrected_at: "2026-11-13T12:00:00Z" });
    expect(t).toMatchObject({ kind: "AGENT_PROPOSAL", originalPayload: { data: original }, correctedById: LAWYER, correctedAt: "2026-11-13T12:00:00Z" });
    expect(proposalTargetFromRow(proposalRow())).toMatchObject({ originalPayload: undefined, correctedById: undefined });
  });
});

describe("corrigir e aprovar (service)", () => {
  const corrected = { ...original, title: "Réplica à contestação", due_at: "2027-03-12T23:59:59-03:00" };

  it("advogado corrige: dados pelo contrato do agente (prioridade padrão), uma chamada ao banco", async () => {
    const semPrioridade: Record<string, unknown> = { ...corrected };
    delete semPrioridade.priority;
    const r = await correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: semPrioridade, notes: "Conferido" });
    expect(repo.correctAndApprove).toHaveBeenCalledTimes(1);
    expect(repo.correctAndApprove).toHaveBeenCalledWith({}, REVIEW, { ...corrected, priority: "NORMAL" }, "Conferido");
    expect(r).toMatchObject({ decisionId: id(77), fields: ["title"] });
  });

  it("assistente e parceiro não corrigem", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      expect(await code(correctAndApproveReview(ctxOf(role), { id: REVIEW, data: corrected }))).toBe("FORBIDDEN");
    }
    expect(repo.correctAndApprove).not.toHaveBeenCalled();
  });

  it("revisão decidida, documento, proposta sem efeito e estrutural não se corrigem", async () => {
    vi.mocked(repo.getById).mockResolvedValueOnce(reviewRow({ status: "APPROVED" }));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: corrected }))).toBe("INVALID_STATE");
    vi.mocked(repo.getById).mockResolvedValueOnce(reviewRow({ agent_proposal_id: null, agent_proposals: null, document_version_id: id(9), document_versions: { version_number: 1, documents: { title: "Minuta" } } }));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: corrected }))).toBe("INVALID_STATE");
    vi.mocked(repo.getById).mockResolvedValueOnce(reviewRow({}, "OTHER"));
    expect(await code(correctAndApproveReview(ctxOf("ADMIN"), { id: REVIEW, data: { description: "Ligar para a cliente." } }))).toBe("INVALID_STATE");
    vi.mocked(repo.getById).mockResolvedValueOnce(reviewRow({}, "UPDATE_AGENT"));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: {} }))).toBe("FORBIDDEN");
    vi.mocked(repo.getById).mockResolvedValueOnce(reviewRow({}, "UPDATE_AGENT"));
    expect(await code(correctAndApproveReview(ctxOf("ADMIN"), { id: REVIEW, data: {} }))).toBe("INVALID_STATE");
    expect(repo.correctAndApprove).not.toHaveBeenCalled();
  });

  it("dados fora do contrato do agente: erro por campo, nada vai ao banco", async () => {
    try {
      await correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { ...corrected, title: "ab", due_at: "2027-03-12", hearing_mode: "ONLINE" } });
      throw new Error("aceitou");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      const err = e as DomainError;
      expect(err.code).toBe("VALIDATION");
      expect(Object.keys(err.fieldErrors ?? {})).toEqual(expect.arrayContaining(["data.title", "data.due_at"]));
    }
    expect(repo.correctAndApprove).not.toHaveBeenCalled();
  });

  it("nada mudou: recusa com a orientação de usar Aprovar", async () => {
    try {
      await correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { ...original } });
      throw new Error("aceitou");
    } catch (e) {
      expect((e as DomainError).code).toBe("INVALID_STATE");
      expect((e as DomainError).publicMessage).toBe(NOTHING_CHANGED_MESSAGE);
    }
    expect(repo.correctAndApprove).not.toHaveBeenCalled();
  });

  it("cada tipo valida pelas próprias regras", async () => {
    vi.mocked(repo.getById).mockResolvedValue(reviewRow({}, "CREATE_PROCESS"));
    vi.mocked(repo.getProposalTarget).mockResolvedValue(proposalRow({ court: "TJRJ" }, "CREATE_PROCESS"));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { court: "TJRJ", cnj_number: "123" } }))).toBe("VALIDATION");
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { court: "TJRJ", state: "RJ" } }))).toBe("OK");
    vi.mocked(repo.getById).mockResolvedValue(reviewRow({}, "UPDATE_CASE"));
    vi.mocked(repo.getProposalTarget).mockResolvedValue(proposalRow({ summary: "Resumo" }, "UPDATE_CASE"));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { status: "ACCEPTED" } }))).toBe("VALIDATION");
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: {} }))).toBe("VALIDATION");
    vi.mocked(repo.getById).mockResolvedValue(reviewRow({}, "REQUEST_DOCUMENT"));
    vi.mocked(repo.getProposalTarget).mockResolvedValue(proposalRow({ label: "Extrato", category: "OTHER", required: true }, "REQUEST_DOCUMENT"));
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { label: "Extrato", category: "extrato" } }))).toBe("VALIDATION");
    expect(await code(correctAndApproveReview(ctxOf("LAWYER"), { id: REVIEW, data: { label: "Extrato do benefício", category: "BENEFIT_STATEMENT" } }))).toBe("OK");
  });
});
