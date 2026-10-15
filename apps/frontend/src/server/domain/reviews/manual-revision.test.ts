import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { legalDocumentObjectName, type DocumentStorage } from "@/server/domain/documents/storage";
import { canEditReview, contentNotEditableMessage, isEditableMime } from "@/features/reviews/manual-revision";
import type { DocumentVersionTargetRow, ReviewRow } from "./mappers";
import { saveManualRevisionSchema } from "./schemas";

// Nada chega ao banco nem à service role: repositórios e Storage simulados.
vi.mock("./repository", () => ({
  getById: vi.fn(),
  getDocumentVersionTarget: vi.fn(),
  prepareManualRevision: vi.fn(),
  commitManualRevision: vi.fn(),
}));
vi.mock("@/server/domain/documents/repository", () => ({ authorizeDownload: vi.fn() }));
vi.mock("@/server/domain/documents/signed-storage", () => ({ signedDocumentStorage: vi.fn() }));

const repo = await import("./repository");
const docsRepo = await import("@/server/domain/documents/repository");
const { getReviewContent, saveManualRevision, contentChecksum } = await import("./manual-revision");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";
const V2 = "44444444-4444-4444-8444-444444444444";
const REVIEW = "55555555-5555-4555-8555-555555555555";
const REVIEW2 = "66666666-6666-4666-8666-666666666666";
const KEY = "77777777-7777-4777-8777-777777777777";

const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db: {} as SupabaseClient,
    requestId: "88888888-8888-4888-8888-888888888888",
    session: { userId: "99999999-9999-4999-8999-999999999999", organizationId: CLIENT, role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const review = (over: Partial<ReviewRow> = {}) => ({ id: REVIEW, document_version_id: V1, legal_analysis_id: null, agent_proposal_id: null, status: "PENDING", ...over }) as ReviewRow;
const target = (over: Partial<DocumentVersionTargetRow> = {}): DocumentVersionTargetRow => ({
  id: V1,
  document_id: DOC,
  version_number: 1,
  original_filename: "minuta.md",
  mime_type: "text/plain",
  file_size: 20,
  storage_object_name: legalDocumentObjectName(CLIENT, DOC, V1, "minuta.md"),
  source: "AGENT",
  created_at: "2026-10-01T10:00:00Z",
  documents: { title: "Minuta", category: "OTHER", visibility: "INTERNAL", status: "ACTIVE" },
  ...over,
});
function fakeStorage(text = "Texto da minuta") {
  return {
    createSignedUploadUrl: vi.fn(),
    getObjectInfo: vi.fn(),
    createSignedDownloadUrl: vi.fn(),
    downloadObject: vi.fn(async () => new TextEncoder().encode(text)),
    uploadObject: vi.fn(async () => undefined),
  } satisfies DocumentStorage;
}

beforeEach(() => vi.clearAllMocks());

describe("conteúdo da minuta em revisão (034)", () => {
  it("texto: lê pelo caminho que o banco autorizou (LGPD + auditoria) e devolve editável", async () => {
    vi.mocked(repo.getById).mockResolvedValue(review());
    vi.mocked(repo.getDocumentVersionTarget).mockResolvedValue(target());
    vi.mocked(docsRepo.authorizeDownload).mockResolvedValue(target().storage_object_name!);
    const storage = fakeStorage();
    const r = await getReviewContent(ctxOf("LAWYER"), REVIEW, { storage });
    expect(r).toEqual({ kind: "TEXT", versionId: V1, versionNumber: 1, mimeType: "text/plain", text: "Texto da minuta", editable: true, readOnlyReason: undefined });
    expect(docsRepo.authorizeDownload).toHaveBeenCalledWith(expect.anything(), V1);
    expect(storage.downloadObject).toHaveBeenCalledWith(target().storage_object_name, 512 * 1024);
  });

  it("revisão decidida: o texto aparece, mas só leitura", async () => {
    vi.mocked(repo.getById).mockResolvedValue(review({ status: "APPROVED" }));
    vi.mocked(repo.getDocumentVersionTarget).mockResolvedValue(target());
    vi.mocked(docsRepo.authorizeDownload).mockResolvedValue(target().storage_object_name!);
    const r = await getReviewContent(ctxOf("ADMIN"), REVIEW, { storage: fakeStorage() });
    expect(r).toMatchObject({ kind: "TEXT", editable: false, readOnlyReason: "DECIDED" });
  });

  it("PDF não é lido (nem registra acesso): indisponível por formato", async () => {
    vi.mocked(repo.getById).mockResolvedValue(review());
    vi.mocked(repo.getDocumentVersionTarget).mockResolvedValue(target({ mime_type: "application/pdf" }));
    const storage = fakeStorage();
    expect(await getReviewContent(ctxOf("LAWYER"), REVIEW, { storage })).toEqual({ kind: "UNAVAILABLE", reason: "FORMAT" });
    expect(docsRepo.authorizeDownload).not.toHaveBeenCalled();
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });

  it("caminho autorizado diferente do da versão: erro interno, nada é lido", async () => {
    vi.mocked(repo.getById).mockResolvedValue(review());
    vi.mocked(repo.getDocumentVersionTarget).mockResolvedValue(target());
    vi.mocked(docsRepo.authorizeDownload).mockResolvedValue("clients/x/documents/y/z/outro.md");
    const storage = fakeStorage();
    await expect(getReviewContent(ctxOf("LAWYER"), REVIEW, { storage })).rejects.toBeInstanceOf(DomainError);
    expect(storage.downloadObject).not.toHaveBeenCalled();
  });

  it("ASSISTANT e parceiro não leem", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN"] as const) await expect(getReviewContent(ctxOf(role), REVIEW, { storage: fakeStorage() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.getById).not.toHaveBeenCalled();
  });
});

describe("salvar edição manual = versão N+1 (034)", () => {
  const input = saveManualRevisionSchema.parse({ idempotencyKey: KEY, reviewId: REVIEW, baseVersionId: V1, content: "Texto revisado" });
  const path = legalDocumentObjectName(CLIENT, DOC, V2, "minuta.md");

  it("ordem: banco autoriza → grava no caminho autorizado → banco registra; checksum e tamanho do texto UTF-8", async () => {
    vi.mocked(repo.prepareManualRevision).mockResolvedValue({ deduplicated: false, document_version_id: V2, object_name: path, mime_type: "text/plain", base_version_number: 1 });
    vi.mocked(repo.commitManualRevision).mockResolvedValue({ deduplicated: false, document_version_id: V2, version_number: 2, review_id: REVIEW2, previous_review_id: REVIEW });
    const storage = fakeStorage();
    const r = await saveManualRevision(ctxOf("LAWYER"), input, { storage });
    expect(r).toEqual({ reviewId: REVIEW2, previousReviewId: REVIEW, versionId: V2, versionNumber: 2, deduplicated: false });
    const bytes = new TextEncoder().encode("Texto revisado");
    expect(storage.uploadObject).toHaveBeenCalledWith(path, bytes, "text/plain");
    expect(repo.commitManualRevision).toHaveBeenCalledWith(expect.anything(), {
      key: KEY,
      reviewId: REVIEW,
      baseVersionId: V1,
      versionId: V2,
      objectName: path,
      size: bytes.byteLength,
      checksum: contentChecksum(bytes),
    });
    expect(vi.mocked(repo.prepareManualRevision).mock.invocationCallOrder[0]).toBeLessThan(storage.uploadObject.mock.invocationCallOrder[0]);
    expect(storage.uploadObject.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(repo.commitManualRevision).mock.invocationCallOrder[0]);
  });

  it("mesma chave já concluída: nada é enviado de novo; devolve a revisão nova anterior", async () => {
    vi.mocked(repo.prepareManualRevision).mockResolvedValue({ deduplicated: true, document_version_id: V2, version_number: 2, review_id: REVIEW2, previous_review_id: REVIEW });
    const storage = fakeStorage();
    expect(await saveManualRevision(ctxOf("LAWYER"), input, { storage })).toMatchObject({ reviewId: REVIEW2, deduplicated: true });
    expect(storage.uploadObject).not.toHaveBeenCalled();
    expect(repo.commitManualRevision).not.toHaveBeenCalled();
  });

  it("caminho autorizado que não é da versão nova: nada é gravado", async () => {
    vi.mocked(repo.prepareManualRevision).mockResolvedValue({ deduplicated: false, document_version_id: V2, object_name: legalDocumentObjectName(CLIENT, DOC, V1, "minuta.md") });
    const storage = fakeStorage();
    await expect(saveManualRevision(ctxOf("LAWYER"), input, { storage })).rejects.toBeInstanceOf(DomainError);
    expect(storage.uploadObject).not.toHaveBeenCalled();
  });

  it("ASSISTANT não salva; conteúdo em branco nem passa pelo schema", async () => {
    await expect(saveManualRevision(ctxOf("ASSISTANT"), input, { storage: fakeStorage() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(saveManualRevisionSchema.safeParse({ ...input, content: "   " }).success).toBe(false);
  });
});

describe("regras de tela", () => {
  it("só texto é editável; revisão aberta ou com alterações pedidas; mensagens claras", () => {
    expect([isEditableMime("text/plain"), isEditableMime("text/markdown; charset=utf-8"), isEditableMime("application/pdf"), isEditableMime(undefined)]).toEqual([true, true, false, false]);
    expect((["PENDING", "REOPENED", "CHANGES_REQUESTED", "APPROVED", "REJECTED"] as const).map(canEditReview)).toEqual([true, true, true, false, false]);
    expect(contentNotEditableMessage("FORMAT")).toMatch(/nova versão do arquivo/);
    expect(contentNotEditableMessage("DECIDED")).toMatch(/reabra/);
  });
});
