import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as documents from "@/server/domain/documents/service";
import { createDocumentSchema, listDocumentsSchema, prepareUploadSchema } from "@/server/domain/documents/schemas";
import { signedDocumentStorage } from "@/server/domain/documents/signed-storage";
import { legalDocumentObjectName } from "@/server/domain/documents/storage";
import * as requirements from "@/server/domain/documents/requirements/service";
import { createRequirementSchema, listRequirementsSchema } from "@/server/domain/documents/requirements/schemas";
import * as clients from "@/server/domain/clients/service";
import { createClientSchema } from "@/server/domain/clients/schemas";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world, type WorldRole } from "./support/world";

/**
 * Documentos no Supabase DEV real: upload em dois passos (idempotente),
 * download com URL assinada + registro LGPD, visibilidade INTERNAL ×
 * PARTNER_VISIBLE, isolamento A × B (IDOR), verificação append-only e
 * pendências (versão de outro cliente é recusada pelo banco).
 *
 * Storage (migration 026): o banco autoriza com o JWT do usuário
 * (authorize_document_upload/download — o download já registra LGPD e
 * DOCUMENT_DOWNLOADED com ator USER) e o servidor assina com a service role
 * só o caminho autorizado (signed-storage.ts). Versões de cenário fora do
 * bloco "com Storage" são gravadas com a service role SÓ como preparação.
 */

const CONTENT = "conteúdo fictício de teste — DG Brasil";

/**
 * O módulo REAL de assinatura (signed-storage.ts), com o client de service
 * role do teste no lugar de createSupabaseAdminClient (as variáveis do Next
 * não existem aqui). Autorização continua 100% com o JWT do papel.
 */
const deps = { storage: signedDocumentStorage(() => serviceDb()) };

/** Caso do parceiro A (caminho real do portal): cliente novo + caso SUBMITTED. */
async function partnerACase(): Promise<{ clientId: string; caseId: string }> {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Documento Parceiro A" },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso documentos ${world.run}`, origin_organization_id: world.partnerA },
  });
  expect(error).toBeNull();
  const r = data as { client_id: string; legal_case_id: string };
  return { clientId: r.client_id, caseId: r.legal_case_id };
}

async function newDocument(role: WorldRole, over: Record<string, unknown>): Promise<string> {
  const input = createDocumentSchema.parse({ category: "IDENTIFICATION", title: "RG do titular", description: "observação interna sigilosa", ...over });
  return (await documents.createDocument(await ctxFor(role), input)).id;
}

/**
 * Preparação SEM Storage: grava uma versão com a service role (o trigger
 * confere o caminho). Só para cenário — o fluxo real está no bloco "com Storage".
 */
async function seedVersion(documentId: string, clientId: string): Promise<string> {
  const id = randomUUID();
  const { error } = await serviceDb()
    .from("document_versions")
    .insert({ id, document_id: documentId, storage_object_name: legalDocumentObjectName(clientId, documentId, id, "semente.txt"), original_filename: "semente.txt", mime_type: "text/plain", file_size: 10, source: "UPLOAD" });
  expect(error).toBeNull();
  return id;
}

/** Fluxo real: prepare → envia os bytes para a URL assinada → confirm. */
async function uploadVersion(role: WorldRole, documentId: string, fileName = "rg frente.txt"): Promise<string> {
  const ctx = await ctxFor(role);
  const body = new Blob([CONTENT], { type: "text/plain" });
  const prepared = await documents.prepareUpload(ctx, prepareUploadSchema.parse({ documentId, fileName, mimeType: "text/plain", sizeBytes: body.size }), deps);
  const sent = await ctx.db.storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, body, { contentType: "text/plain" });
  expect(sent.error).toBeNull();
  const confirmed = await documents.confirmUpload(ctx, { documentId, versionId: prepared.versionId, fileName }, deps);
  expect(confirmed).toEqual({ documentId, versionId: prepared.versionId, alreadyConfirmed: false });
  return prepared.versionId;
}

async function downloadAuditEvents(versionId: string, role: WorldRole) {
  const { data } = await serviceDb()
    .from("audit_events")
    .select("action, actor_type, entity_id")
    .eq("action", "DOCUMENT_DOWNLOADED")
    .eq("entity_id", versionId)
    .eq("actor_user_id", world.users[role].id);
  return data ?? [];
}

async function downloadAccessEvents(versionId: string, role: WorldRole) {
  const { data } = await serviceDb()
    .from("personal_data_access_events")
    .select("action, resource_type, resource_id, actor_type, request_id")
    .eq("resource_id", versionId)
    .eq("actor_user_id", world.users[role].id);
  return data ?? [];
}

let caseA: { clientId: string; caseId: string };

beforeAll(async () => {
  caseA = await partnerACase();
});

describe("documentos — visibilidade e isolamento (sem Storage)", () => {
  it("parceiro A não vê documento INTERNAL do próprio caso; B não vê nada de A (IDOR)", async () => {
    const internalDoc = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const sharedDoc = await newDocument("LAWYER", { legalCaseId: caseA.caseId, title: "Procuração" });
    await seedVersion(internalDoc, caseA.clientId);
    await seedVersion(sharedDoc, caseA.clientId);
    await documents.setVisibility(await ctxFor("LAWYER"), { id: sharedDoc, visibility: "PARTNER_VISIBLE" });

    const a = await ctxFor("PARTNER_USER_A");
    await expectDomainError(documents.getDocument(a, internalDoc), "NOT_FOUND");
    await expectDomainError(documents.downloadDocument(a, { documentId: internalDoc }, deps), "NOT_FOUND");
    const list = await documents.listDocuments(a, listDocumentsSchema.parse({ legalCaseId: caseA.caseId, pageSize: 50 }));
    expect(list.items.map((d) => d.id)).toContain(sharedDoc);
    expect(list.items.map((d) => d.id)).not.toContain(internalDoc);

    const b = await ctxFor("PARTNER_ADMIN_B");
    await expectDomainError(documents.getDocument(b, sharedDoc), "NOT_FOUND");
    await expectDomainError(documents.downloadDocument(b, { documentId: sharedDoc }, deps), "NOT_FOUND");
    const listB = await documents.listDocuments(b, listDocumentsSchema.parse({ legalCaseId: caseA.caseId }));
    expect(listB.items).toHaveLength(0);
    await expectDomainError(requirements.listRequirements(b, listRequirementsSchema.parse({ legalCaseId: caseA.caseId })), "NOT_FOUND");
  });

  it("versão de OUTRO documento não é baixada pelo id do documento compartilhado (IDOR por versão)", async () => {
    const internalDoc = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const internalVersion = await seedVersion(internalDoc, caseA.clientId);
    const sharedDoc = await newDocument("LAWYER", { legalCaseId: caseA.caseId, visibility: "PARTNER_VISIBLE" });
    await seedVersion(sharedDoc, caseA.clientId);
    await expectDomainError(documents.downloadDocument(await ctxFor("PARTNER_USER_A"), { documentId: sharedDoc, versionId: internalVersion }, deps), "NOT_FOUND");
  });

  it("ficha do parceiro não tem campo interno; a interna tem", async () => {
    const id = await newDocument("LAWYER", { legalCaseId: caseA.caseId, visibility: "PARTNER_VISIBLE" });
    await seedVersion(id, caseA.clientId);
    const partner = await documents.getDocument(await ctxFor("PARTNER_USER_A"), id);
    expect(partner.surface).toBe("PARTNER");
    const json = JSON.stringify(partner);
    expect(json).not.toContain("observação interna sigilosa");
    expect(json).not.toContain("clients/");
    expect(partner.document).not.toHaveProperty("description");
    expect(partner.document.versions[0]).not.toHaveProperty("approval");

    const internal = await documents.getDocument(await ctxFor("ASSISTANT"), id);
    if (internal.surface !== "INTERNAL") throw new Error("ficha interna");
    expect(internal.document.description).toBe("observação interna sigilosa");
    expect(internal.document.versions[0]).toMatchObject({ verification: "UNVERIFIED", approval: "PENDING", source: "UPLOAD" });
    expect(internal.document.legalCaseIds).toEqual([caseA.caseId]);
  });

  it("compartilhar exige caso de parceiro e arquivo", async () => {
    const lawyer = await ctxFor("LAWYER");
    const { id: ownClient } = await clients.createClient(
      lawyer,
      createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Cliente Documento Interno", originOfficeId: world.owner }),
    );
    const clientDoc = await newDocument("LAWYER", { clientId: ownClient });
    await seedVersion(clientDoc, ownClient);
    await expectDomainError(documents.setVisibility(lawyer, { id: clientDoc, visibility: "PARTNER_VISIBLE" }), "BUSINESS_RULE");

    const noFile = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    await expectDomainError(documents.setVisibility(lawyer, { id: noFile, visibility: "PARTNER_VISIBLE" }), "BUSINESS_RULE");
    await expectDomainError(documents.setVisibility(await ctxFor("PARTNER_ADMIN_A"), { id: noFile, visibility: "PARTNER_VISIBLE" }), "FORBIDDEN");
  });

  it("parceiro cria documento no próprio caso (sem RETURNING) e nunca como INTERNAL", async () => {
    const pa = await ctxFor("PARTNER_ADMIN_A");
    const id = await newDocument("PARTNER_ADMIN_A", { legalCaseId: caseA.caseId, description: undefined });
    const detail = await documents.getDocument(pa, id);
    expect(detail.document.legalCaseIds).toEqual([caseA.caseId]);
    const { data } = await serviceDb().from("documents").select("visibility, created_by, client_id").eq("id", id).single();
    expect(data).toEqual({ visibility: "PARTNER_VISIBLE", created_by: world.users.PARTNER_ADMIN_A.id, client_id: caseA.clientId });
    await expectDomainError(
      documents.createDocument(pa, createDocumentSchema.parse({ legalCaseId: caseA.caseId, category: "OTHER", title: "x", visibility: "INTERNAL" })),
      "FORBIDDEN",
    );
    // Caso de outro parceiro: não encontrado.
    await expectDomainError(
      documents.createDocument(await ctxFor("PARTNER_ADMIN_B"), createDocumentSchema.parse({ legalCaseId: caseA.caseId, category: "OTHER", title: "x" })),
      "NOT_FOUND",
    );
  });

  it("verificação é append-only e só da equipe interna", async () => {
    const id = await newDocument("LAWYER", { legalCaseId: caseA.caseId, visibility: "PARTNER_VISIBLE" });
    const versionId = await seedVersion(id, caseA.clientId);
    const lawyer = await ctxFor("LAWYER");
    await documents.verifyVersion(lawyer, { versionId, status: "FAILED", notes: "ilegível" });
    await documents.verifyVersion(lawyer, { versionId, status: "VERIFIED" });
    const detail = await documents.getDocument(lawyer, id);
    expect(detail.document.versions[0].verification).toBe("VERIFIED");
    const { count } = await serviceDb().from("document_version_verifications").select("id", { count: "exact", head: true }).eq("document_version_id", versionId);
    expect(count).toBe(2);
    await expectDomainError(documents.verifyVersion(await ctxFor("PARTNER_ADMIN_A"), { versionId, status: "VERIFIED" }), "FORBIDDEN");
  });
});

describe("pendências de documento do caso", () => {
  it("versão de outro cliente é recusada; versão do caso atende; só LAWYER/ADMIN aprova", async () => {
    const lawyer = await ctxFor("LAWYER");
    const req = await requirements.createRequirement(
      lawyer,
      createRequirementSchema.parse({ legalCaseId: caseA.caseId, label: "RG do cliente", category: "IDENTIFICATION", requestNow: true }),
    );
    expect(req.status).toBe("REQUESTED");

    const { id: otherClient } = await clients.createClient(
      lawyer,
      createClientSchema.parse({ kind: "INDIVIDUAL", cpf: fakeCpf(), fullName: "Outro Cliente", originOfficeId: world.owner }),
    );
    const otherDoc = await newDocument("LAWYER", { clientId: otherClient });
    const otherVersion = await seedVersion(otherDoc, otherClient);
    await expectDomainError(requirements.satisfyRequirement(lawyer, { id: req.id, documentVersionId: otherVersion }), "INVALID_STATE", /mesmo cliente/);

    // Mesmo cliente, mas documento NÃO vinculado ao caso: também recusado.
    const unlinked = await newDocument("LAWYER", { clientId: caseA.clientId });
    const unlinkedVersion = await seedVersion(unlinked, caseA.clientId);
    await expectDomainError(requirements.satisfyRequirement(lawyer, { id: req.id, documentVersionId: unlinkedVersion }), "INVALID_STATE", /vinculado/);

    const caseDoc = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const caseVersion = await seedVersion(caseDoc, caseA.clientId);
    const received = await requirements.satisfyRequirement(await ctxFor("ASSISTANT"), { id: req.id, documentVersionId: caseVersion });
    expect(received).toMatchObject({ status: "RECEIVED", satisfiedByDocumentVersionId: caseVersion });

    await expectDomainError(requirements.approveRequirement(await ctxFor("ASSISTANT"), req.id), "FORBIDDEN");
    expect((await requirements.approveRequirement(lawyer, req.id)).status).toBe("APPROVED");
    await expectDomainError(requirements.requestRequirement(lawyer, req.id), "INVALID_STATE");

    // Parceiro A vê a pendência do próprio caso, sem o id da versão.
    const list = await requirements.listRequirements(await ctxFor("PARTNER_USER_A"), listRequirementsSchema.parse({ legalCaseId: caseA.caseId }));
    const mine = list.items.find((r) => r.id === req.id);
    expect(mine).toMatchObject({ surface: "PARTNER", status: "APPROVED" });
    expect(mine).not.toHaveProperty("satisfiedByDocumentVersionId");
    // Documento que atende pendência não é excluído.
    await expectDomainError(documents.removeDocument(await ctxFor("ADMIN"), caseDoc), "INVALID_STATE");
  });
});

describe("documentos — com Storage (upload e download reais)", () => {
  it("interno: prepare → upload → confirm (idempotente) → download funciona e registra acesso LGPD", async () => {
    const id = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const versionId = await uploadVersion("LAWYER", id);
    const lawyer = await ctxFor("LAWYER");

    // Confirmar de novo não cria segunda versão.
    expect(await documents.confirmUpload(lawyer, { documentId: id, versionId, fileName: "rg frente.txt" }, deps)).toMatchObject({ alreadyConfirmed: true });
    const { data: versions } = await serviceDb().from("document_versions").select("id, version_number, file_size, mime_type, created_by").eq("document_id", id);
    expect(versions).toEqual([{ id: versionId, version_number: 1, file_size: new Blob([CONTENT]).size, mime_type: "text/plain", created_by: world.users.LAWYER.id }]);

    const link = await documents.downloadDocument(lawyer, { documentId: id }, deps);
    expect(link).toMatchObject({ documentId: id, versionId, expiresInSeconds: 60 });
    const response = await fetch(link.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(CONTENT);
    expect(await downloadAccessEvents(versionId, "LAWYER")).toEqual([
      expect.objectContaining({ action: "DOWNLOAD", resource_type: "DOCUMENT_VERSION", resource_id: versionId, actor_type: "USER" }),
    ]);
    // Um registro só (sem LGPD duplicado no TypeScript) + auditoria com ator USER.
    expect(await downloadAuditEvents(versionId, "LAWYER")).toEqual([{ action: "DOCUMENT_DOWNLOADED", actor_type: "USER", entity_id: versionId }]);
  });

  it("confirmar sem enviar o arquivo é recusado (nenhuma versão criada)", async () => {
    const id = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const ctx = await ctxFor("LAWYER");
    const prepared = await documents.prepareUpload(ctx, prepareUploadSchema.parse({ documentId: id, fileName: "nada.txt", mimeType: "text/plain", sizeBytes: 5 }), deps);
    await expectDomainError(documents.confirmUpload(ctx, { documentId: id, versionId: prepared.versionId, fileName: "nada.txt" }, deps), "INVALID_STATE");
    const { count } = await serviceDb().from("document_versions").select("id", { count: "exact", head: true }).eq("document_id", id);
    expect(count).toBe(0);
  });

  it("parceiro A baixa documento PARTNER_VISIBLE do próprio caso; B não", async () => {
    const id = await newDocument("LAWYER", { legalCaseId: caseA.caseId });
    const versionId = await uploadVersion("LAWYER", id, "extrato.txt");
    await documents.setVisibility(await ctxFor("LAWYER"), { id, visibility: "PARTNER_VISIBLE" });

    const link = await documents.downloadDocument(await ctxFor("PARTNER_USER_A"), { documentId: id }, deps);
    expect((await fetch(link.url)).status).toBe(200);
    expect(await downloadAccessEvents(versionId, "PARTNER_USER_A")).toHaveLength(1);
    await expectDomainError(documents.downloadDocument(await ctxFor("PARTNER_USER_B"), { documentId: id }, deps), "NOT_FOUND");
    expect(await downloadAccessEvents(versionId, "PARTNER_USER_B")).toHaveLength(0);
    expect(await downloadAuditEvents(versionId, "PARTNER_USER_A")).toHaveLength(1);
    expect(await downloadAuditEvents(versionId, "PARTNER_USER_B")).toHaveLength(0);
  });

  it("parceiro A envia arquivo no próprio caso (documento + versão sem RETURNING)", async () => {
    const id = await newDocument("PARTNER_ADMIN_A", { legalCaseId: caseA.caseId, description: undefined });
    const versionId = await uploadVersion("PARTNER_ADMIN_A", id, "comprovante.txt");
    const internal = await documents.getDocument(await ctxFor("LAWYER"), id);
    if (internal.surface !== "INTERNAL") throw new Error("ficha interna");
    expect(internal.document.versions.map((v) => [v.id, v.source, v.createdBy])).toEqual([[versionId, "UPLOAD", world.users.PARTNER_ADMIN_A.id]]);
  });
});
