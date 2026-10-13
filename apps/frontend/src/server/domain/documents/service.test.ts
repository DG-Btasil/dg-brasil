import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/lib/auth/types";
import { createServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import type { DocumentRow, VersionRow } from "./mappers";
import { legalDocumentObjectName, type DocumentStorage } from "./storage";

// O service nunca chega ao banco nem à service role neste teste.
vi.mock("./repository", () => ({
  getDocument: vi.fn(),
  getVersion: vi.fn(),
  listVersions: vi.fn(),
  authorizeUpload: vi.fn(),
  authorizeDownload: vi.fn(),
  insertVersion: vi.fn(),
}));
vi.mock("./signed-storage", () => ({ signedDocumentStorage: vi.fn() }));

const repo = await import("./repository");
const service = await import("./service");

const CLIENT = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const OTHER_DOC = "44444444-4444-4444-8444-444444444444";

const db = {} as SupabaseClient;
const ctxOf = (role: AppSession["role"]) =>
  createServiceContext({
    db,
    requestId: "55555555-5555-4555-8555-555555555555",
    session: { userId: "66666666-6666-4666-8666-666666666666", organizationId: CLIENT, role, surface: role.startsWith("PARTNER") ? "PARTNER" : "INTERNAL" } as AppSession,
  });

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: DOC,
  client_id: CLIENT,
  category: "IDENTIFICATION",
  title: "RG",
  description: null,
  visibility: "PARTNER_VISIBLE",
  status: "ACTIVE",
  created_by: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  deleted_at: null,
  ...over,
});
const version = (over: Partial<VersionRow> = {}): VersionRow => ({
  id: VERSION,
  document_id: DOC,
  version_number: 1,
  storage_object_name: legalDocumentObjectName(CLIENT, DOC, VERSION, "rg.pdf"),
  original_filename: "rg.pdf",
  mime_type: "application/pdf",
  file_size: 10,
  source: "UPLOAD",
  created_by: null,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

function fakeStorage(): DocumentStorage & { [K in keyof DocumentStorage]: ReturnType<typeof vi.fn> } {
  return {
    createSignedUploadUrl: vi.fn(async () => ({ signedUrl: "https://upload", token: "t" })),
    getObjectInfo: vi.fn(async () => ({ sizeBytes: 10, contentType: "application/pdf" })),
    createSignedDownloadUrl: vi.fn(async () => "https://download"),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("upload: o banco autoriza o caminho antes de qualquer assinatura", () => {
  it("assina exatamente o caminho devolvido por authorize_document_upload (JWT do usuário)", async () => {
    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.authorizeUpload).mockImplementation(async (_db, d, v, f) => legalDocumentObjectName(CLIENT, d, v, f));
    const storage = fakeStorage();
    const out = await service.prepareUpload(ctxOf("ASSISTANT"), { documentId: DOC, fileName: "rg.pdf", mimeType: "application/pdf", sizeBytes: 10 }, { storage });
    expect(repo.authorizeUpload).toHaveBeenCalledWith(db, DOC, out.versionId, "rg.pdf");
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(legalDocumentObjectName(CLIENT, DOC, out.versionId, "rg.pdf"));
  });

  it("caminho do banco diferente do calculado: nada é assinado", async () => {
    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.authorizeUpload).mockResolvedValue(`clients/${CLIENT}/documents/${OTHER_DOC}/${VERSION}/rg.pdf`);
    const storage = fakeStorage();
    const p = service.prepareUpload(ctxOf("LAWYER"), { documentId: DOC, fileName: "rg.pdf", mimeType: "application/pdf", sizeBytes: 10 }, { storage });
    await expect(p).rejects.toMatchObject({ code: "INTERNAL" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("recusa do banco vira NOT_FOUND e nada é assinado", async () => {
    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.authorizeUpload).mockRejectedValue(new DomainError("FORBIDDEN", "Documento não encontrado"));
    const storage = fakeStorage();
    const p = service.prepareUpload(ctxOf("PARTNER_USER"), { documentId: DOC, fileName: "rg.pdf", mimeType: "application/pdf", sizeBytes: 10 }, { storage });
    await expect(p).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("confirmação repetida não reautoriza nem insere; sem objeto no Storage não cria versão", async () => {
    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.getVersion).mockResolvedValueOnce(version());
    const storage = fakeStorage();
    const again = await service.confirmUpload(ctxOf("LAWYER"), { documentId: DOC, versionId: VERSION, fileName: "rg.pdf" }, { storage });
    expect(again.alreadyConfirmed).toBe(true);
    expect(repo.authorizeUpload).not.toHaveBeenCalled();

    vi.mocked(repo.getVersion).mockResolvedValue(null);
    vi.mocked(repo.authorizeUpload).mockImplementation(async (_db, d, v, f) => legalDocumentObjectName(CLIENT, d, v, f));
    storage.getObjectInfo.mockResolvedValueOnce(null);
    await expect(service.confirmUpload(ctxOf("LAWYER"), { documentId: DOC, versionId: VERSION, fileName: "rg.pdf" }, { storage })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    expect(repo.insertVersion).not.toHaveBeenCalled();
  });
});

describe("download: authorize_document_download antes de assinar", () => {
  it("o banco autoriza (e registra LGPD + auditoria) e só então a URL de 60 s é assinada", async () => {
    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.listVersions).mockResolvedValue([version()]);
    vi.mocked(repo.authorizeDownload).mockResolvedValue(version().storage_object_name);
    const storage = fakeStorage();
    const out = await service.downloadDocument(ctxOf("PARTNER_USER"), { documentId: DOC }, { storage });
    expect(repo.authorizeDownload).toHaveBeenCalledWith(db, VERSION);
    expect(storage.createSignedDownloadUrl).toHaveBeenCalledWith(version().storage_object_name, 60, "rg.pdf");
    expect(vi.mocked(repo.authorizeDownload).mock.invocationCallOrder[0]).toBeLessThan(storage.createSignedDownloadUrl.mock.invocationCallOrder[0]);
    expect(out).toEqual({ documentId: DOC, versionId: VERSION, url: "https://download", expiresInSeconds: 60 });
  });

  it("parceiro com documento INTERNAL, versão de outro documento ou recusa do banco: NOT_FOUND, nada assinado", async () => {
    const storage = fakeStorage();
    vi.mocked(repo.getDocument).mockResolvedValue(doc({ visibility: "INTERNAL" }));
    await expect(service.downloadDocument(ctxOf("PARTNER_ADMIN"), { documentId: DOC }, { storage })).rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(repo.getDocument).mockResolvedValue(doc());
    vi.mocked(repo.getVersion).mockResolvedValue(version({ document_id: OTHER_DOC }));
    await expect(service.downloadDocument(ctxOf("PARTNER_ADMIN"), { documentId: DOC, versionId: VERSION }, { storage })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(repo.authorizeDownload).not.toHaveBeenCalled();

    vi.mocked(repo.getVersion).mockResolvedValue(version());
    vi.mocked(repo.authorizeDownload).mockRejectedValue(new DomainError("FORBIDDEN", "Arquivo não encontrado"));
    await expect(service.downloadDocument(ctxOf("LAWYER"), { documentId: DOC, versionId: VERSION }, { storage })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
