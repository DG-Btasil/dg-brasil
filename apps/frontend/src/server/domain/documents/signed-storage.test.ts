import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

// O módulo real exige a chave secreta e `server-only`: aqui o client admin é falso.
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => { throw new Error("não usar no teste"); }) }));
vi.mock("server-only", () => ({}));

const { signedDocumentStorage } = await import("./signed-storage");

function fakeAdmin() {
  const bucketApi = {
    createSignedUploadUrl: vi.fn(async () => ({ data: { signedUrl: "u", token: "t", path: "p" }, error: null })),
    info: vi.fn(async () => ({ data: null, error: { statusCode: "404", message: "Object not found clients/x/RG_Maria.pdf" } })),
    createSignedUrl: vi.fn(async () => ({ data: null, error: { statusCode: "403", message: "clients/x/RG_Maria.pdf" } })),
  };
  const from = vi.fn(() => bucketApi);
  return { client: { storage: { from } } as unknown as SupabaseClient, from, bucketApi };
}

describe("signed-storage (único uso da service role no domínio)", () => {
  it("só assina no bucket legal-documents, upload write-once", async () => {
    const admin = fakeAdmin();
    const storage = signedDocumentStorage(() => admin.client);
    await storage.createSignedUploadUrl("clients/a/documents/b/c/rg.pdf");
    expect(admin.from).toHaveBeenCalledWith("legal-documents");
    expect(admin.bucketApi.createSignedUploadUrl).toHaveBeenCalledWith("clients/a/documents/b/c/rg.pdf", { upsert: false });
  });

  it("objeto inexistente = null; erro do Storage nunca repassa o caminho", async () => {
    const admin = fakeAdmin();
    const storage = signedDocumentStorage(() => admin.client);
    expect(await storage.getObjectInfo("clients/x/RG_Maria.pdf")).toBeNull();
    const error = await storage.createSignedDownloadUrl("clients/x/RG_Maria.pdf", 60, "RG_Maria.pdf").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect((error as Error).message).not.toMatch(/clients|Maria/);
  });
});
