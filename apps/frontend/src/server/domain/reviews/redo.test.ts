import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { redoFromRow, type ReviewRow } from "./mappers";
import { MAX_REDO_ROUNDS, officeQueueNotice, REDO_MESSAGE_MAX, REDO_MESSAGE_MIN, redoRoundLabel } from "./redo-rules";
import { redoReviewSchema } from "./schemas";

// Nada chega ao banco: o repositório é simulado. A regra testada é a do service.
vi.mock("./repository", () => ({
  getById: vi.fn(),
  getRedo: vi.fn(),
  redo: vi.fn(),
  listDecisions: vi.fn(),
  getProposalTarget: vi.fn(),
}));

const repo = await import("./repository");
const { getReview, redoReview } = await import("./service");

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REVIEW = id(1);
const RUN = id(600);
const RECADO = "A data está errada: conte a partir de segunda.";

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: id(999),
    session: { userId: id(900), organizationId: id(901), role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const row = (over: Partial<ReviewRow> = {}, type = "CREATE_DEADLINE"): ReviewRow => ({
  id: REVIEW,
  legal_case_id: id(500),
  legal_process_id: null,
  document_version_id: null,
  legal_analysis_id: null,
  agent_proposal_id: id(2),
  agent_run_id: RUN,
  status: "PENDING",
  priority: "NORMAL",
  assigned_reviewer_id: null,
  due_at: null,
  created_at: "2026-11-13T10:00:00Z",
  updated_at: "2026-11-13T10:00:00Z",
  decided_at: null,
  agent_proposals: { proposal_type: type, payload: { summary: "Prazo", data: { title: "Réplica" } } },
  ...over,
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
  vi.mocked(repo.getById).mockResolvedValue(row());
  vi.mocked(repo.redo).mockResolvedValue({ agent_run_id: id(601), round: 1, deduplicated: false });
  vi.mocked(repo.listDecisions).mockResolvedValue([]);
  vi.mocked(repo.getProposalTarget).mockResolvedValue(null);
});

describe("regras do refazer", () => {
  it("recado de 10 a 4000 caracteres, sem contar os espaços das pontas", () => {
    expect([REDO_MESSAGE_MIN, REDO_MESSAGE_MAX, MAX_REDO_ROUNDS]).toEqual([10, 4000, 3]);
    expect(redoReviewSchema.safeParse({ id: REVIEW, message: "   curto   " }).success).toBe(false);
    expect(redoReviewSchema.safeParse({ id: REVIEW, message: "x".repeat(4001) }).success).toBe(false);
    expect(redoReviewSchema.parse({ id: REVIEW, message: `  ${RECADO}  ` }).message).toBe(RECADO);
  });

  it("aviso de fila: execução desligada ou computador desconectado; tudo certo, sem aviso", () => {
    expect(officeQueueNotice({ executionEnabled: false, online: true })?.title).toMatch(/desligada/);
    expect(officeQueueNotice({ executionEnabled: true, online: false })?.title).toMatch(/Nenhum computador do escritório conectado/);
    expect(officeQueueNotice({ executionEnabled: true, online: true })).toBeNull();
    expect(officeQueueNotice(undefined)).toBeNull();
    expect(officeQueueNotice({ executionEnabled: false, online: false })?.message).toMatch(/entra na fila mesmo assim/);
  });

  it("rótulo da rodada", () => {
    expect(redoRoundLabel(1)).toBe("Este será o refazer 1 de 3 a partir do trabalho original.");
    expect(redoRoundLabel(3)).toMatch(/3 de 3/);
  });

  it("situação vinda do banco → DTO (os dois lados do vínculo)", () => {
    expect(redoFromRow(null)).toBeNull();
    const dto = redoFromRow({
      agent_run_id: RUN, agent_name: "Agente de prazos", run_status: "WAITING_HUMAN", round: 1, redo_of_run_id: id(599), redo_of_review_id: id(3),
      redone: { agent_run_id: id(601), status: "QUEUED", created_at: "2026-11-13T12:00:00Z", requested_by: id(900), review_id: null },
      redone_from_review: true, can_redo: false, blocked: "DECIDED", message: "Esta revisão já foi decidida.",
    });
    expect(dto).toEqual({
      agentRunId: RUN, agentName: "Agente de prazos", runStatus: "WAITING_HUMAN", round: 1, redoOfRunId: id(599), redoOfReviewId: id(3),
      redone: { agentRunId: id(601), status: "QUEUED", createdAt: "2026-11-13T12:00:00Z", requestedById: id(900), reviewId: undefined },
      redoneFromThisReview: true, canRedo: false, blocked: "DECIDED", message: "Esta revisão já foi decidida.",
    });
    expect(redoFromRow({ agent_run_id: null, can_redo: false, blocked: "NO_RUN" })).toMatchObject({ agentRunId: undefined, round: 0, canRedo: false, redone: undefined });
  });
});

describe("pedir para o agente refazer (service)", () => {
  it("advogado pede: uma chamada ao banco, com o recado", async () => {
    const r = await redoReview(ctxOf("LAWYER"), { id: REVIEW, message: RECADO });
    expect(repo.redo).toHaveBeenCalledWith({}, REVIEW, RECADO);
    expect(r).toEqual({ agentRunId: id(601), round: 1, deduplicated: false });
  });

  it("assistente e parceiro nunca pedem", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN", "PARTNER_USER"] as const) {
      expect(await code(redoReview(ctxOf(role), { id: REVIEW, message: RECADO }))).toBe("FORBIDDEN");
    }
    expect(repo.redo).not.toHaveBeenCalled();
  });

  it("item enviado por pessoa, revisão decidida e estrutural sem ADMIN são recusados", async () => {
    vi.mocked(repo.getById).mockResolvedValueOnce(row({ agent_run_id: null }));
    expect(await code(redoReview(ctxOf("LAWYER"), { id: REVIEW, message: RECADO }))).toBe("INVALID_STATE");
    vi.mocked(repo.getById).mockResolvedValueOnce(row({ status: "REJECTED" }));
    expect(await code(redoReview(ctxOf("LAWYER"), { id: REVIEW, message: RECADO }))).toBe("INVALID_STATE");
    vi.mocked(repo.getById).mockResolvedValueOnce(row({}, "UPDATE_AGENT"));
    expect(await code(redoReview(ctxOf("LAWYER"), { id: REVIEW, message: RECADO }))).toBe("FORBIDDEN");
    vi.mocked(repo.getById).mockResolvedValueOnce(row({}, "UPDATE_AGENT"));
    expect(await code(redoReview(ctxOf("ADMIN"), { id: REVIEW, message: RECADO }))).toBe("OK");
    expect(repo.redo).toHaveBeenCalledTimes(1);
  });

  it("a ficha da revisão traz a situação do refazer; se ela falhar, a revisão abre sem o botão", async () => {
    vi.mocked(repo.getRedo).mockResolvedValueOnce({ agent_run_id: RUN, round: 0, can_redo: true });
    expect((await getReview(ctxOf("LAWYER"), REVIEW)).redo).toMatchObject({ agentRunId: RUN, canRedo: true });
    vi.mocked(repo.getRedo).mockRejectedValueOnce(new DomainError("INTERNAL"));
    expect((await getReview(ctxOf("LAWYER"), REVIEW)).redo).toBeNull();
  });
});
