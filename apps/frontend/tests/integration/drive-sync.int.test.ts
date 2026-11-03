import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "@/server/core/logger";
import { syncDeps } from "@/server/domain/drive/service";
import * as reviews from "@/server/domain/reviews/service";
import { decideReviewSchema } from "@/server/domain/reviews/schemas";
import type { DriveClient, DriveFile } from "@/server/integrations/google-drive/client";
import { processExports, syncLink } from "@/server/integrations/google-drive/sync";
import { integrationEnv } from "./support/env";
import { ctxFor, dbFor, serviceDb, world } from "./support/world";

/**
 * Google Drive (migration 041) contra o Supabase DEV real, SEM conta Google:
 * o Drive é simulado em memória; banco (funções drive_* pelo login
 * dg_worker), Storage, gatilho de aprovação e o código de sincronização do
 * servidor são os de verdade.
 *
 *   - uma pasta por cliente e um cliente por pasta, pelo ID; trocar guarda histórico;
 *   - importação vira documento INTERNO; (arquivo, md5) entra uma vez só;
 *   - aprovação em Revisões põe a versão na fila; o envio grava o ID do arquivo;
 *     o que o DG Brasil exportou não volta como importação;
 *   - pasta pública não recebe arquivo; desligar tira da fila sem apagar nada.
 *
 * Dados FICTÍCIOS.
 */

integrationEnv();
if (!process.env.DG_WORKER_DB_URL) {
  throw new Error("Falta DG_WORKER_DB_URL em supabase/.env.real (login dg_worker pelo pooler IPv4 do Supabase).");
}

const svc = serviceDb();
const tag = `drive-${world.run}`;
const id = (p: string) => `${p}${randomUUID().replace(/-/g, "")}`;
const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const state = { clientA: "", caseA: "", clientB: "", linkId: "", folder1: id("pastaUm"), folder2: id("pastaDois"), firstVersion: "", secondVersion: "" };

// Drive simulado: pasta → arquivos; envio devolve um ID novo.
const files: DriveFile[] = [];
const blobs = new Map<string, Uint8Array>();
const uploaded: { folder: string; name: string; id: string }[] = [];
let publicFolder = false;
const drive = {
  listFiles: async (folder: string) => (folder === state.folder2 ? [...files] : []),
  download: async (fileId: string) => blobs.get(fileId)!,
  isPublic: async () => publicFolder,
  upload: async (folder: string, name: string) => {
    const up = { folder, name, id: id("drvUp") };
    uploaded.push(up);
    return { id: up.id };
  },
} as unknown as DriveClient;
const deps = () => syncDeps({ log: createLogger({ test: "drive" }) }, drive);

function putFile(fileId: string, name: string, mimeType: string, text: string | null) {
  if (text === null) {
    files.push({ id: fileId, name, mimeType });
    return;
  }
  const bytes = new TextEncoder().encode(text);
  blobs.set(fileId, bytes);
  const i = files.findIndex((f) => f.id === fileId);
  const f = { id: fileId, name, mimeType, md5Checksum: md5(bytes), size: bytes.byteLength };
  if (i >= 0) files[i] = f; else files.push(f);
}

async function newCase(label: string) {
  const r = await dbFor("PARTNER_ADMIN_A").rpc("partner_submit_case", {
    p_client: { document: `999${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, kind: "INDIVIDUAL", origin_organization_id: world.partnerA, full_name: `Cliente Fictício ${label} ${tag}` },
    p_case: { legal_area_id: world.bankingAreaId, title: `Caso Drive ${label} ${tag}`, origin_organization_id: world.partnerA },
  });
  if (r.error) throw new Error(r.error.message);
  const caseId = (r.data as { legal_case_id: string }).legal_case_id;
  const { data } = await svc.from("legal_cases").select("client_id").eq("id", caseId).single();
  return { caseId, clientId: String(data!.client_id) };
}

async function link(role: "LAWYER" | "PARTNER_ADMIN_A", clientId: string, folderId: string) {
  return (role === "LAWYER" ? (await ctxFor("LAWYER")).db : dbFor(role)).rpc("drive_link_client_folder", { p_client_id: clientId, p_folder_id: folderId, p_folder_name: `PASTA ${tag}` });
}

async function clientDocs() {
  const { data } = await svc.from("documents").select("id, title, visibility, category").eq("client_id", state.clientA);
  return data ?? [];
}

async function approveVersion(versionId: string) {
  const reviewId = randomUUID();
  const ins = await svc.from("reviews").insert({ id: reviewId, document_version_id: versionId, legal_case_id: state.caseA });
  if (ins.error) throw new Error(ins.error.message);
  await reviews.decideReview(await ctxFor("LAWYER"), decideReviewSchema.parse({ id: reviewId, decision: "APPROVED" }));
  const { data } = await svc.from("external_document_exports").select("id, status, folder_link_id, attempts, external_file_id, last_error").eq("document_version_id", versionId).single();
  return data!;
}

beforeAll(async () => {
  const a = await newCase("A");
  const b = await newCase("B");
  Object.assign(state, { clientA: a.clientId, caseA: a.caseId, clientB: b.clientId });
});

afterAll(async () => {
  const lawyer = await ctxFor("LAWYER");
  for (const c of [state.clientA, state.clientB]) if (c) await lawyer.db.rpc("drive_unlink_client_folder", { p_client_id: c });
});

describe("Google Drive no banco real (041), Drive simulado", () => {
  it("uma pasta por cliente e um cliente por pasta, pelo ID; trocar guarda histórico; parceiro não liga", async () => {
    expect((await link("LAWYER", state.clientA, "curto")).error?.message).toMatch(/ID de pasta do Drive inválido/);
    expect((await link("LAWYER", state.clientA, state.folder1)).data).toMatchObject({ changed: true });
    expect((await link("LAWYER", state.clientB, state.folder1)).error?.message).toMatch(/já está ligada a outro cliente/);
    expect((await link("LAWYER", state.clientA, state.folder1)).data).toMatchObject({ changed: false });
    expect((await link("PARTNER_ADMIN_A", state.clientA, state.folder2)).error).not.toBeNull();

    expect((await link("LAWYER", state.clientA, state.folder2)).data).toMatchObject({ changed: true });
    expect((await link("LAWYER", state.clientB, state.folder1)).data).toMatchObject({ changed: true });
    const lawyer = await ctxFor("LAWYER");
    const d = (await lawyer.db.rpc("get_client_drive", { p_client_id: state.clientA })).data as { link: { id: string; folder_id: string } };
    expect(d.link.folder_id).toBe(state.folder2);
    state.linkId = d.link.id;
    expect((await lawyer.db.rpc("drive_unlink_client_folder", { p_client_id: state.clientB })).data).toMatchObject({ unlinked: true });
  });

  it("importação: arquivo novo vira documento INTERNO no Storage real; (arquivo, md5) entra uma vez; Google Docs nativo fica de fora", async () => {
    putFile(id("drvPdf"), "extrato-ficticio.pdf", "application/pdf", `%PDF-1.4\n% extrato FICTÍCIO ${tag}\n%%EOF\n`);
    putFile(id("drvDoc"), "anotacoes", "application/vnd.google-apps.document", null);
    const ln = { id: state.linkId, client_id: state.clientA, folder_id: state.folder2 };

    expect(await syncLink(ln, deps())).toEqual({ imported: 1, skipped: 1, failed: 0 });
    const docs = await clientDocs();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "extrato-ficticio.pdf", visibility: "INTERNAL", category: "OTHER" });
    const { data: v } = await svc.from("document_versions").select("id, source, checksum_sha256").eq("document_id", docs[0].id).single();
    expect(v).toMatchObject({ source: "IMPORT", checksum_sha256: createHash("sha256").update(blobs.get(files[0].id)!).digest("hex") });
    state.firstVersion = v!.id;

    expect(await syncLink(ln, deps())).toEqual({ imported: 0, skipped: 2, failed: 0 });
    expect(await clientDocs()).toHaveLength(1);

    // O mesmo arquivo editado no Drive (md5 novo) entra uma vez como documento novo.
    putFile(files[0].id, "extrato-ficticio.pdf", "application/pdf", `%PDF-1.4\n% extrato FICTÍCIO editado ${tag}\n%%EOF\n`);
    expect(await syncLink(ln, deps())).toEqual({ imported: 1, skipped: 1, failed: 0 });
    expect(await syncLink(ln, deps())).toEqual({ imported: 0, skipped: 2, failed: 0 });
    const after = await clientDocs();
    expect(after).toHaveLength(2);
    const { data: v2 } = await svc.from("document_versions").select("id").eq("document_id", after.find((x) => x.id !== docs[0].id)!.id).single();
    state.secondVersion = v2!.id;

    const s = (await (await ctxFor("LAWYER")).db.rpc("get_client_drive", { p_client_id: state.clientA })).data as { imports: number; link: { last_synced_at: string | null; last_sync_error: string | null } };
    expect(s.imports).toBe(2);
    expect(s.link.last_synced_at).toBeTruthy();
    expect(s.link.last_sync_error).toBeNull();
  });

  it("exportação: aprovar em Revisões põe na fila; o servidor envia como arquivo novo; o exportado não volta como importação", async () => {
    const queued = await approveVersion(state.firstVersion);
    expect(queued).toMatchObject({ status: "PENDING", folder_link_id: state.linkId, attempts: 0 });

    expect(await processExports(deps())).toEqual({ exported: 1, failed: 0 });
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]).toMatchObject({ folder: state.folder2, name: "extrato-ficticio.pdf (v1, DG Brasil).pdf" });
    const { data: done } = await svc.from("external_document_exports").select("status, external_file_id, exported_at").eq("id", queued.id).single();
    expect(done).toMatchObject({ status: "EXPORTED", external_file_id: uploaded[0].id });
    expect(done!.exported_at).toBeTruthy();

    putFile(uploaded[0].id, uploaded[0].name, "application/pdf", "%PDF-1.4\n% cópia exportada\n%%EOF\n");
    const r = await syncLink({ id: state.linkId, client_id: state.clientA, folder_id: state.folder2 }, deps());
    expect(r).toEqual({ imported: 0, skipped: 3, failed: 0 });
    expect(await clientDocs()).toHaveLength(2);
  });

  it("pasta pública não recebe arquivo; desligar a pasta tira da fila sem apagar nada", async () => {
    const queued = await approveVersion(state.secondVersion);
    expect(queued.status).toBe("PENDING");
    publicFolder = true;
    expect(await processExports(deps())).toEqual({ exported: 0, failed: 1 });
    expect(uploaded).toHaveLength(1);
    const { data: blocked } = await svc.from("external_document_exports").select("status, attempts, last_error").eq("id", queued.id).single();
    expect(blocked).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(blocked!.last_error).toMatch(/qualquer pessoa com o link/);

    const lawyer = await ctxFor("LAWYER");
    expect((await lawyer.db.rpc("drive_unlink_client_folder", { p_client_id: state.clientA })).data).toMatchObject({ unlinked: true });
    const { data: skipped } = await svc.from("external_document_exports").select("status").eq("id", queued.id).single();
    expect(skipped!.status).toBe("SKIPPED");
    expect(((await lawyer.db.rpc("get_client_drive", { p_client_id: state.clientA })).data as { link: unknown }).link).toBeNull();
    expect(await clientDocs()).toHaveLength(2);
  });
});
