import { describe, expect, it } from "vitest";
import { confirmUploadSchema, createDocumentSchema, listDocumentsSchema, prepareUploadSchema, verifyVersionSchema } from "./schemas";
import {
  buildStatusIndex,
  currentVersionOf,
  downloadNameOf,
  internalDocumentFromRows,
  partnerDocumentFromRows,
  partnerListItemFromRow,
  type DocumentRow,
  type VersionRow,
} from "./mappers";
import { fromStorageError, legalDocumentObjectName, objectNameMatchesVersion, sanitizeFilename } from "./storage";
import { canTransition, internalRequirementFromRow, partnerRequirementFromRow, type RequirementRow } from "./requirements/mappers";
import { createRequirementSchema } from "./requirements/schemas";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const VERSION_2 = "44444444-4444-4444-8444-444444444444";
const CASE = "55555555-5555-4555-8555-555555555555";

describe("caminho no Storage = regra do banco (private.legal_document_object_name)", () => {
  it("sanitiza como private.sanitize_filename", () => {
    expect(sanitizeFilename("RG frente.pdf")).toBe("RG_frente.pdf");
    expect(sanitizeFilename("Procuração assinada (1).PDF")).toBe("Procura_o_assinada_1_.PDF");
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFilename("__.hidden._")).toBe("hidden");
    expect(sanitizeFilename("a/b\\c.pdf")).toBe("a_b_c.pdf");
    expect(sanitizeFilename("")).toBe("arquivo");
    expect(sanitizeFilename("***")).toBe("arquivo");
    expect(sanitizeFilename(null)).toBe("arquivo");
    expect(sanitizeFilename("x".repeat(300))).toHaveLength(150);
    // Emoji (par substituto) vira um único "_", como no Postgres.
    expect(sanitizeFilename("contrato 😀 final.pdf")).toBe("contrato_final.pdf");
  });

  it("monta clients/{cliente}/documents/{documento}/{versão}/{arquivo} sem barra no nome", () => {
    const path = legalDocumentObjectName(CLIENT, DOC, VERSION, "Extrato INSS/2024.pdf");
    expect(path).toBe(`clients/${CLIENT}/documents/${DOC}/${VERSION}/Extrato_INSS_2024.pdf`);
    expect(objectNameMatchesVersion(path, CLIENT, DOC, VERSION)).toBe(true);
  });

  it("ids sempre em minúsculas (o Postgres formata uuid assim)", () => {
    expect(legalDocumentObjectName(CLIENT.toUpperCase(), DOC, VERSION.toUpperCase(), "a.pdf")).toBe(`clients/${CLIENT}/documents/${DOC}/${VERSION}/a.pdf`);
  });

  it("caminho de outra versão/cliente ou com subpasta não confere", () => {
    const path = legalDocumentObjectName(CLIENT, DOC, VERSION, "a.pdf");
    expect(objectNameMatchesVersion(path, CLIENT, DOC, VERSION_2)).toBe(false);
    expect(objectNameMatchesVersion(path, DOC, DOC, VERSION)).toBe(false);
    expect(objectNameMatchesVersion(`clients/${CLIENT}/documents/${DOC}/${VERSION}/x/a.pdf`, CLIENT, DOC, VERSION)).toBe(false);
    expect(objectNameMatchesVersion(`clients/${CLIENT}/documents/${DOC}/${VERSION}/`, CLIENT, DOC, VERSION)).toBe(false);
  });

  it("erro do Storage nunca repassa a mensagem (pode conter o caminho)", () => {
    const e = fromStorageError({ statusCode: "403", message: `new row violates row-level security policy clients/${CLIENT}/RG_Maria.pdf` });
    expect(e.code).toBe("FORBIDDEN");
    expect(e.publicMessage).not.toMatch(/clients|Maria|row-level/);
    expect(fromStorageError({ statusCode: "404" }).code).toBe("NOT_FOUND");
    expect(fromStorageError({ status: 409 }).code).toBe("CONFLICT");
    expect(fromStorageError(null).code).toBe("INTERNAL");
  });
});

describe("schemas de documento", () => {
  it("listagem exige exatamente um escopo (cliente, caso ou processo)", () => {
    expect(listDocumentsSchema.safeParse({}).success).toBe(false);
    expect(listDocumentsSchema.safeParse({ clientId: CLIENT, legalCaseId: CASE }).success).toBe(false);
    const ok = listDocumentsSchema.parse({ legalCaseId: CASE });
    expect(ok).toMatchObject({ page: 1, pageSize: 25, column: "updated_at", ascending: false });
  });

  it("ordenação só por whitelist", () => {
    expect(listDocumentsSchema.safeParse({ clientId: CLIENT, sortBy: "storage_object_name" }).success).toBe(false);
    expect(listDocumentsSchema.parse({ clientId: CLIENT, sortBy: "title", sortDirection: "asc" })).toMatchObject({ column: "title", ascending: true });
  });

  it("upload: tipo e tamanho do bucket; nome sem barra nem controle", () => {
    const base = { documentId: DOC, fileName: "rg.pdf", mimeType: "application/pdf", sizeBytes: 1000 };
    expect(prepareUploadSchema.safeParse(base).success).toBe(true);
    expect(prepareUploadSchema.safeParse({ ...base, mimeType: "application/x-msdownload" }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, sizeBytes: 52_428_801 }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, sizeBytes: 0 }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, fileName: "../rg.pdf" }).success).toBe(false);
    expect(prepareUploadSchema.safeParse({ ...base, fileName: "rg\u0000.pdf" }).success).toBe(false);
    expect(confirmUploadSchema.safeParse({ documentId: DOC, versionId: "nao-e-uuid", fileName: "rg.pdf" }).success).toBe(false);
  });

  it("criação: categoria do catálogo (formato) e ao menos um destino", () => {
    expect(createDocumentSchema.safeParse({ category: "IDENTIFICATION", title: "RG" }).success).toBe(false);
    expect(createDocumentSchema.parse({ legalCaseId: CASE, category: "identification", title: " RG " })).toMatchObject({ category: "IDENTIFICATION", title: "RG" });
    expect(createDocumentSchema.safeParse({ legalCaseId: CASE, category: "rg;drop", title: "RG" }).success).toBe(false);
  });

  it("verificação: só VERIFIED ou FAILED (UNVERIFIED é ausência de registro)", () => {
    expect(verifyVersionSchema.safeParse({ versionId: VERSION, status: "UNVERIFIED" }).success).toBe(false);
    expect(verifyVersionSchema.parse({ versionId: VERSION, status: "FAILED", notes: "  " })).toEqual({ versionId: VERSION, status: "FAILED", notes: undefined });
  });
});

const docRow: DocumentRow = {
  id: DOC,
  client_id: CLIENT,
  category: "IDENTIFICATION",
  title: "RG",
  description: "observação interna sigilosa",
  visibility: "PARTNER_VISIBLE",
  status: "ACTIVE",
  created_by: "66666666-6666-4666-8666-666666666666",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-02T10:00:00Z",
  deleted_at: null,
};
const v1: VersionRow = {
  id: VERSION,
  document_id: DOC,
  version_number: 1,
  storage_object_name: `clients/${CLIENT}/documents/${DOC}/${VERSION}/rg.pdf`,
  original_filename: "rg.pdf",
  mime_type: "application/pdf",
  file_size: "2048",
  source: "AGENT",
  created_by: null,
  created_at: "2026-10-01T10:00:00Z",
};
const v2: VersionRow = { ...v1, id: VERSION_2, version_number: 2, storage_object_name: `clients/${CLIENT}/documents/${DOC}/${VERSION_2}/rg.pdf`, source: "UPLOAD" };

describe("mapeamento de documento por superfície", () => {
  const index = buildStatusIndex(
    [{ document_version_id: VERSION_2, verification_status: "VERIFIED", verified_at: "2026-10-03T10:00:00Z" }],
    [
      { document_version_id: VERSION, approval_status: "SUPERSEDED" },
      { document_version_id: VERSION_2, approval_status: "APPROVED" },
    ],
  );
  const links = { legalCaseIds: [CASE], legalProcessIds: [] };

  it("versão atual = maior número; sem verificação registrada = UNVERIFIED", () => {
    expect(currentVersionOf([v1, v2])?.id).toBe(VERSION_2);
    expect(currentVersionOf([])).toBeUndefined();
    const detail = internalDocumentFromRows(docRow, [v1, v2], index, links);
    expect(detail.versions.map((v) => [v.versionNumber, v.verification, v.approval])).toEqual([
      [2, "VERIFIED", "APPROVED"],
      [1, "UNVERIFIED", "SUPERSEDED"],
    ]);
    expect(detail.versions[0].sizeBytes).toBe(2048);
    expect(detail.description).toBe("observação interna sigilosa");
  });

  it("DTO do parceiro não tem campo interno nem caminho do Storage", () => {
    const partnerIndex = buildStatusIndex(index.verification.size ? [...index.verification.values()] : [], []);
    const detail = partnerDocumentFromRows(docRow, [v1, v2], partnerIndex, links);
    const json = JSON.stringify(detail);
    expect(json).not.toContain("observação interna sigilosa");
    expect(json).not.toContain("clients/");
    expect(json).not.toContain(docRow.created_by as string);
    for (const field of ["description", "createdBy", "visibility"]) expect(detail).not.toHaveProperty(field);
    for (const field of ["source", "createdBy", "approval", "verifiedAt", "storageObjectName"]) expect(detail.versions[0]).not.toHaveProperty(field);
    expect(detail.versions[0].verification).toBe("VERIFIED");
    const item = partnerListItemFromRow(docRow, v2, partnerIndex);
    expect(item.currentVersion).not.toHaveProperty("approval");
    expect(JSON.stringify(item)).not.toContain("clients/");
  });

  it("nome do download: original sanitizado, ou o último segmento do caminho", () => {
    expect(downloadNameOf({ original_filename: "RG Maria.pdf", storage_object_name: v1.storage_object_name }, sanitizeFilename)).toBe("RG_Maria.pdf");
    expect(downloadNameOf({ original_filename: null, storage_object_name: v1.storage_object_name }, sanitizeFilename)).toBe("rg.pdf");
  });
});

describe("pendências de documento", () => {
  const row: RequirementRow = {
    id: "77777777-7777-4777-8777-777777777777",
    legal_case_id: CASE,
    requirement_label: "RG do cliente",
    category: "IDENTIFICATION",
    required: true,
    status: "RECEIVED",
    satisfied_by_document_version_id: VERSION,
    requested_at: null,
    satisfied_at: "2026-10-03T10:00:00Z",
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
  };

  it("parceiro não recebe o id da versão que atende", () => {
    expect(internalRequirementFromRow(row).satisfiedByDocumentVersionId).toBe(VERSION);
    expect(partnerRequirementFromRow(row)).not.toHaveProperty("satisfiedByDocumentVersionId");
    expect(JSON.stringify(partnerRequirementFromRow(row))).not.toContain(VERSION);
  });

  it("máquina de estados", () => {
    expect(canTransition("MISSING", "REQUEST")).toBe(true);
    expect(canTransition("REJECTED", "REQUEST")).toBe(true);
    expect(canTransition("APPROVED", "REQUEST")).toBe(false);
    expect(canTransition("REQUESTED", "SATISFY")).toBe(true);
    expect(canTransition("APPROVED", "SATISFY")).toBe(false);
    expect(canTransition("RECEIVED", "APPROVE")).toBe(true);
    expect(canTransition("REQUESTED", "APPROVE")).toBe(false);
    expect(canTransition("MISSING", "REJECT")).toBe(false);
  });

  it("schema de criação", () => {
    expect(createRequirementSchema.parse({ legalCaseId: CASE, label: "RG", category: "IDENTIFICATION" })).toMatchObject({ required: true, requestNow: false });
    expect(createRequirementSchema.safeParse({ legalCaseId: CASE, label: "", category: "IDENTIFICATION" }).success).toBe(false);
  });
});
