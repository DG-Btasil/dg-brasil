import { describe, expect, it } from "vitest";
import * as documents from "@/server/domain/documents/service";
import { confirmUploadSchema, createDocumentSchema, listDocumentsSchema, prepareUploadSchema } from "@/server/domain/documents/schemas";
import { signedDocumentStorage } from "@/server/domain/documents/signed-storage";
import * as requirements from "@/server/domain/documents/requirements/service";
import { createRequirementSchema, listRequirementsSchema } from "@/server/domain/documents/requirements/schemas";
import { documentListInput } from "@/features/documents/constants";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world, type WorldRole } from "./support/world";

/**
 * Etapa 4.3 — Fase C no Supabase DEV: o caminho que a TELA de documentos
 * percorre (criar → autorizar envio → enviar para a URL assinada → confirmar;
 * listar por cliente/caso/processo; baixar; verificar; pendências) com o JWT
 * de cada papel. A assinatura usa o módulo real (service role só para
 * assinar o caminho que o banco autorizou).
 */

const deps = { storage: signedDocumentStorage(() => serviceDb()) };
const BODY = "arquivo fictício da Fase C — DG Brasil";

async function partnerCase(): Promise<{ clientId: string; caseId: string }> {
  const { data, error } = await (await ctxFor("PARTNER_ADMIN_A")).db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Documentos Fase C" },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso documentos Fase C ${world.run}`, origin_organization_id: world.partnerA },
  });
  expect(error).toBeNull();
  const r = data as { client_id: string; legal_case_id: string };
  return { clientId: r.client_id, caseId: r.legal_case_id };
}

/** Os passos 2–4 da tela (prepare → upload → confirm). Devolve o id da versão. */
async function sendFile(role: WorldRole, documentId: string, fileName = "extrato.txt", options: { skipUpload?: boolean } = {}) {
  const ctx = await ctxFor(role);
  const prepared = await documents.prepareUpload(ctx, prepareUploadSchema.parse({ documentId, fileName, mimeType: "text/plain", sizeBytes: BODY.length }), deps);
  if (!options.skipUpload) {
    const { error } = await ctx.db.storage.from(prepared.bucket).uploadToSignedUrl(prepared.path, prepared.token, new Blob([BODY], { type: "text/plain" }), { contentType: "text/plain" });
    expect(error).toBeNull();
  }
  const confirm = () => documents.confirmUpload(ctx, confirmUploadSchema.parse({ documentId, versionId: prepared.versionId, fileName, mimeType: "text/plain" }), deps);
  return { versionId: prepared.versionId, confirm };
}

async function newCaseDocument(caseId: string, title = "Extrato do benefício") {
  return (await documents.createDocument(await ctxFor("LAWYER"), createDocumentSchema.parse({ legalCaseId: caseId, category: "BENEFIT_STATEMENT", title }))).id;
}

const list = async (role: WorldRole, scope: Parameters<typeof documentListInput>[0]) =>
  documents.listDocuments(await ctxFor(role), listDocumentsSchema.parse(documentListInput(scope)));

describe("Fase C — documentos pela UI", () => {
  it("envio em etapas: confirmação repetida não duplica; aparece no caso e no cliente como não verificado", async () => {
    const { clientId, caseId } = await partnerCase();
    const documentId = await newCaseDocument(caseId);
    const sent = await sendFile("LAWYER", documentId);
    expect((await sent.confirm()).alreadyConfirmed).toBe(false);
    expect((await sent.confirm()).alreadyConfirmed).toBe(true);
    for (const scope of [{ legalCaseId: caseId }, { clientId }]) {
      const row = (await list("LAWYER", scope)).items.find((d) => d.id === documentId);
      expect(row?.currentVersion).toMatchObject({ id: sent.versionId, versionNumber: 1, verification: "UNVERIFIED" });
    }
  });

  it("confirmar sem o arquivo ter chegado: erro (a tela não finge sucesso)", async () => {
    const { caseId } = await partnerCase();
    const sent = await sendFile("LAWYER", await newCaseDocument(caseId, "Sem arquivo"), "nada.txt", { skipUpload: true });
    await expectDomainError(sent.confirm(), "INVALID_STATE", /ainda não chegou/);
  });

  it("verificação é da versão: nova versão nasce não verificada", async () => {
    const { caseId } = await partnerCase();
    const documentId = await newCaseDocument(caseId, "Contrato");
    const v1 = await sendFile("LAWYER", documentId, "v1.txt");
    await v1.confirm();
    await documents.verifyVersion(await ctxFor("ASSISTANT"), { versionId: v1.versionId, status: "VERIFIED" });
    expect((await list("LAWYER", { legalCaseId: caseId })).items.find((d) => d.id === documentId)?.currentVersion?.verification).toBe("VERIFIED");
    const v2 = await sendFile("LAWYER", documentId, "v2.txt");
    await v2.confirm();
    const current = (await list("LAWYER", { legalCaseId: caseId })).items.find((d) => d.id === documentId)?.currentVersion;
    expect(current).toMatchObject({ versionNumber: 2, verification: "UNVERIFIED" });
  });

  it("download: URL assinada curta pelo servidor", async () => {
    const { caseId } = await partnerCase();
    const documentId = await newCaseDocument(caseId, "Para baixar");
    await (await sendFile("LAWYER", documentId)).confirm();
    const dl = await documents.downloadDocument(await ctxFor("LAWYER"), { documentId }, deps);
    expect(dl.expiresInSeconds).toBe(60);
    expect(dl.url).toMatch(/^https?:\/\//);
  });

  it("parceiro só vê o documento depois de compartilhado (o servidor confere as regras)", async () => {
    const { caseId } = await partnerCase();
    const documentId = await newCaseDocument(caseId, "Interno até compartilhar");
    await (await sendFile("LAWYER", documentId)).confirm();
    expect((await list("PARTNER_ADMIN_A", { legalCaseId: caseId })).items.map((d) => d.id)).not.toContain(documentId);
    await documents.setVisibility(await ctxFor("LAWYER"), { id: documentId, visibility: "PARTNER_VISIBLE" });
    expect((await list("PARTNER_ADMIN_A", { legalCaseId: caseId })).items.map((d) => d.id)).toContain(documentId);
    expect((await list("PARTNER_ADMIN_B", { clientId: (await list("LAWYER", { legalCaseId: caseId })).items[0].clientId })).items).toHaveLength(0);
  });
});

describe("Fase C — pendências documentais pela UI", () => {
  it("solicitado → arquivo recebido → aprovado; ASSISTANT não aprova", async () => {
    const { caseId } = await partnerCase();
    const lawyer = await ctxFor("LAWYER");
    const req = await requirements.createRequirement(lawyer, createRequirementSchema.parse({ legalCaseId: caseId, label: "Extrato do INSS", category: "BENEFIT_STATEMENT", required: true, requestNow: true }));
    expect(req.status).toBe("REQUESTED");
    const documentId = await newCaseDocument(caseId, "Extrato do INSS");
    const sent = await sendFile("LAWYER", documentId);
    await sent.confirm();
    expect((await requirements.satisfyRequirement(await ctxFor("ASSISTANT"), { id: req.id, documentVersionId: sent.versionId })).status).toBe("RECEIVED");
    await expectDomainError(requirements.approveRequirement(await ctxFor("ASSISTANT"), req.id), "FORBIDDEN");
    expect((await requirements.approveRequirement(lawyer, req.id)).status).toBe("APPROVED");
    const page = await requirements.listRequirements(lawyer, listRequirementsSchema.parse({ legalCaseId: caseId, pageSize: 50 }));
    expect(page.items.find((r) => r.id === req.id)).toMatchObject({ status: "APPROVED", satisfiedByDocumentVersionId: sent.versionId });
  });
});
