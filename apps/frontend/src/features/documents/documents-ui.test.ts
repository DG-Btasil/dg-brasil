import { beforeEach, describe, expect, it, vi } from "vitest";

/* Actions e Storage simulados: o teste cobre a ORQUESTRAÇÃO do envio na tela. */
const calls: string[] = [];
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  prepare: vi.fn(),
  confirm: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/server/domain/documents/actions", () => ({
  createDocumentAction: (i: unknown) => mocks.create(i),
  prepareDocumentUploadAction: (i: unknown) => mocks.prepare(i),
  confirmDocumentUploadAction: (i: unknown) => mocks.confirm(i),
}));
vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowserClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: (...args: unknown[]) => mocks.put(...args) }) } }),
}));

import { listDocumentsSchema } from "@/server/domain/documents/schemas";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/server/domain/documents/storage";
import { ALLOWED_FILE_TYPES, documentListInput, formatBytes, MAX_UPLOAD_BYTES } from "./constants";
import { checkFile, createAndUpload, uploadVersion } from "./upload";

const DOC = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";
const VER = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const ok = <T>(data: T) => ({ ok: true as const, data, requestId: "r" });
const fail = (code = "INTERNAL", message = "falhou") => ({ ok: false as const, error: { code, message }, requestId: "3f2a9c1d-0000" });
const file = (type = "application/pdf", size = 1000) => new File([new Uint8Array(size)], "Extrato Março.pdf", { type });

beforeEach(() => {
  calls.length = 0;
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.create.mockImplementation(async () => (calls.push("create"), ok({ id: DOC })));
  mocks.prepare.mockImplementation(async () => (calls.push("prepare"), ok({ documentId: DOC, versionId: VER, signedUrl: "u", token: "t", bucket: "legal-documents", path: "p" })));
  mocks.put.mockImplementation(async () => (calls.push("put"), { error: null }));
  mocks.confirm.mockImplementation(async () => (calls.push("confirm"), ok({ documentId: DOC, versionId: VER, alreadyConfirmed: false })));
});

describe("limites de arquivo — iguais aos do servidor/bucket", () => {
  it("tipos e tamanho em sincronia com server/domain/documents/storage.ts", () => {
    expect([...ALLOWED_FILE_TYPES]).toEqual([...ALLOWED_MIME_TYPES]);
    expect(MAX_UPLOAD_BYTES).toBe(MAX_FILE_SIZE_BYTES);
  });
  it("arquivo vazio, grande demais ou de tipo não aceito é recusado ANTES do servidor", () => {
    expect(checkFile({ type: "application/pdf", size: 0 })).toMatch(/vazio/);
    expect(checkFile({ type: "application/pdf", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/50 MB/);
    expect(checkFile({ type: "application/x-msdownload", size: 10 })).toMatch(/não aceito/);
    expect(checkFile({ type: "image/png", size: 10 })).toBeUndefined();
  });
  it("tamanho legível", () => {
    expect([formatBytes(512), formatBytes(2048), formatBytes(5 * 1024 * 1024)]).toEqual(["512 B", "2 KB", "5,0 MB"]);
  });
  it("consulta da lista passa no schema do servidor (exatamente um escopo)", () => {
    expect(listDocumentsSchema.safeParse(documentListInput({ legalCaseId: DOC })).success).toBe(true);
    expect(listDocumentsSchema.safeParse({ ...documentListInput({ clientId: DOC }), legalCaseId: VER }).success).toBe(false);
  });
});

describe("envio em etapas", () => {
  it("documento novo: criar → autorizar → enviar → confirmar, nesta ordem", async () => {
    const steps: string[] = [];
    const r = await createAndUpload({ legalCaseId: DOC, category: "OTHER", title: "Extrato" }, file(), (s) => steps.push(s));
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["create", "prepare", "put", "confirm"]);
    expect(steps).toEqual(["create", "prepare", "upload", "confirm", "done"]);
    // O id da versão é o do SERVIDOR; o navegador não escolhe caminho.
    expect(mocks.confirm).toHaveBeenCalledWith({ documentId: DOC, versionId: VER, fileName: "Extrato Março.pdf", mimeType: "application/pdf" });
  });

  it("tipo não aceito: nada é pedido ao servidor", async () => {
    const r = await createAndUpload({ legalCaseId: DOC, category: "OTHER", title: "x" }, file("application/zip"), () => {});
    expect(r.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("falha no envio do arquivo: não confirma; retomar pede outra URL", async () => {
    mocks.put.mockImplementationOnce(async () => (calls.push("put"), { error: { message: "rede" } }));
    const r = await uploadVersion(DOC, file(), () => {});
    expect(r).toMatchObject({ ok: false, step: "upload", resume: { step: "upload", documentId: DOC } });
    expect(calls).toEqual(["prepare", "put"]);
  });

  it("arquivo enviado mas confirmação falhou: NÃO finge sucesso; retomar confirma a MESMA versão sem reenviar", async () => {
    mocks.confirm.mockImplementationOnce(async () => (calls.push("confirm"), fail()));
    const first = await uploadVersion(DOC, file(), () => {});
    expect(first.ok).toBe(false);
    if (first.ok || first.resume?.step !== "confirm") throw new Error("esperava retomada pela confirmação");
    expect(first.resume.versionId).toBe(VER);
    calls.length = 0;
    const retry = await uploadVersion(DOC, file(), () => {}, first.resume);
    expect(retry.ok).toBe(true);
    expect(calls).toEqual(["confirm"]);
  });

  it("falha de rede ao chamar a action vira erro recuperável (sem exceção)", async () => {
    mocks.prepare.mockImplementationOnce(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await uploadVersion(DOC, file(), () => {});
    expect(r).toMatchObject({ ok: false, step: "prepare" });
  });
});
