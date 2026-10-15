import { createHash, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as manual from "@/server/domain/reviews/manual-revision";
import { saveManualRevisionSchema } from "@/server/domain/reviews/schemas";
import { legalDocumentObjectName, LEGAL_DOCUMENTS_BUCKET } from "@/server/domain/documents/storage";
import { ctxFor, expectDomainError, fakeCpf, serviceDb, world } from "./support/world";

/**
 * Etapa 4.3.1 — edição manual durante a revisão (migration 034) no Supabase
 * DEV real: Storage de verdade, versão N intacta (linha E arquivo), versão N+1
 * MANUAL_EDIT, decisão append-only na revisão N e revisão nova para N+1.
 * Minuta FICTÍCIA criada pela service role só no setup (como o worker faria).
 */

const svc = serviceDb();
const ORIGINAL = "MINUTA FICTÍCIA DE TESTE\n\nCláusula 1. Texto original.";

let caseId = "";
let clientId = "";

async function draftUnderReview(): Promise<{ docId: string; v1: string; reviewId: string; path: string }> {
  const docId = randomUUID();
  const v1 = randomUUID();
  const path = legalDocumentObjectName(clientId, docId, v1, "minuta.md");
  const bytes = new TextEncoder().encode(ORIGINAL);
  const doc = await svc.from("documents").insert({ id: docId, client_id: clientId, category: "OTHER", title: `Minuta 4.3.1 ${world.run}` });
  if (doc.error) throw new Error(`documento: ${doc.error.message}`);
  await svc.from("case_documents").insert({ legal_case_id: caseId, document_id: docId, purpose: "AGENT_DRAFT" });
  const up = await svc.storage.from(LEGAL_DOCUMENTS_BUCKET).upload(path, bytes, { contentType: "text/plain", upsert: false });
  if (up.error) throw new Error(`storage: ${up.error.message}`);
  const ver = await svc.from("document_versions").insert({
    id: v1,
    document_id: docId,
    storage_object_name: path,
    original_filename: "minuta.md",
    mime_type: "text/plain",
    file_size: bytes.byteLength,
    checksum_sha256: createHash("sha256").update(bytes).digest("hex"),
    source: "AGENT",
  });
  if (ver.error) throw new Error(`versão: ${ver.error.message}`);
  const rv = await svc.from("reviews").insert({ legal_case_id: caseId, document_version_id: v1, priority: "HIGH", assigned_reviewer_id: world.users.LAWYER.id }).select("id").single();
  if (rv.error) throw new Error(`revisão: ${rv.error.message}`);
  return { docId, v1, reviewId: rv.data.id, path };
}

const readObject = async (path: string) => new TextDecoder().decode(await (await svc.storage.from(LEGAL_DOCUMENTS_BUCKET).download(path)).data!.arrayBuffer());

beforeAll(async () => {
  const db = (await ctxFor("PARTNER_ADMIN_A")).db;
  const { data, error } = await db.rpc("partner_submit_case", {
    p_client: { document: fakeCpf(), kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: "Cliente Edição 4.3.1" },
    p_case: { legal_area_id: world.bankingAreaId, title: "Caso edição 4.3.1", origin_organization_id: world.partnerA },
  });
  if (error) throw new Error(`partner_submit_case: ${error.message}`);
  caseId = (data as { legal_case_id: string }).legal_case_id;
  clientId = (await svc.from("legal_cases").select("client_id").eq("id", caseId).single()).data!.client_id;
});

describe("edição manual na revisão (034)", () => {
  it("LAWYER lê o texto, salva: N+1 MANUAL_EDIT com revisão nova; a N (linha e arquivo) fica intacta", async () => {
    const d = await draftUnderReview();
    const lawyer = await ctxFor("LAWYER");
    const content = await manual.getReviewContent(lawyer, d.reviewId);
    expect(content).toMatchObject({ kind: "TEXT", text: ORIGINAL, editable: true, versionNumber: 1 });

    const key = randomUUID();
    const input = saveManualRevisionSchema.parse({ idempotencyKey: key, reviewId: d.reviewId, baseVersionId: d.v1, content: ORIGINAL.replace("original", "revisado") });
    const saved = await manual.saveManualRevision(lawyer, input);
    expect(saved).toMatchObject({ previousReviewId: d.reviewId, versionNumber: 2, deduplicated: false });

    expect(await readObject(d.path)).toBe(ORIGINAL);
    const versions = (await svc.from("document_versions").select("id, version_number, source, created_by, storage_object_name").eq("document_id", d.docId).order("version_number")).data!;
    expect(versions.map((v) => [v.version_number, v.source])).toEqual([
      [1, "AGENT"],
      [2, "MANUAL_EDIT"],
    ]);
    expect(versions[1].created_by).toBe(world.users.LAWYER.id);
    expect(await readObject(versions[1].storage_object_name)).toContain("revisado");

    const old = (await svc.from("reviews").select("status").eq("id", d.reviewId).single()).data!;
    expect(old.status).toBe("CHANGES_REQUESTED");
    const fresh = (await svc.from("reviews").select("status, document_version_id, priority, assigned_reviewer_id").eq("id", saved.reviewId).single()).data!;
    expect(fresh).toEqual({ status: "PENDING", document_version_id: saved.versionId, priority: "HIGH", assigned_reviewer_id: world.users.LAWYER.id });

    // Mesma chave: o mesmo resultado, sem versão nova nem arquivo novo.
    const again = await manual.saveManualRevision(lawyer, input);
    expect(again).toMatchObject({ reviewId: saved.reviewId, versionId: saved.versionId, deduplicated: true });
    expect((await svc.from("document_versions").select("id", { count: "exact", head: true }).eq("document_id", d.docId)).count).toBe(2);

    const { data: ev } = await svc.from("audit_events").select("actor_user_id").eq("entity_id", saved.versionId).eq("action", "DOCUMENT_MANUALLY_REVISED");
    expect(ev?.map((e) => e.actor_user_id)).toEqual([world.users.LAWYER.id]);
  });

  it("editar a partir da versão antiga (revisão da N) é recusado depois que a N+1 existe", async () => {
    const d = await draftUnderReview();
    const lawyer = await ctxFor("LAWYER");
    await manual.saveManualRevision(lawyer, saveManualRevisionSchema.parse({ idempotencyKey: randomUUID(), reviewId: d.reviewId, baseVersionId: d.v1, content: "Primeira edição" }));
    await expectDomainError(
      manual.saveManualRevision(lawyer, saveManualRevisionSchema.parse({ idempotencyKey: randomUUID(), reviewId: d.reviewId, baseVersionId: d.v1, content: "Edição sobre base velha" })),
      "INVALID_STATE",
    );
  });

  it("ASSISTANT e parceiro não leem nem editam", async () => {
    const d = await draftUnderReview();
    const input = saveManualRevisionSchema.parse({ idempotencyKey: randomUUID(), reviewId: d.reviewId, baseVersionId: d.v1, content: "x" });
    for (const role of ["ASSISTANT", "PARTNER_ADMIN_A"] as const) {
      await expectDomainError(manual.getReviewContent(await ctxFor(role), d.reviewId), "FORBIDDEN");
      await expectDomainError(manual.saveManualRevision(await ctxFor(role), input), "FORBIDDEN");
    }
  });
});
