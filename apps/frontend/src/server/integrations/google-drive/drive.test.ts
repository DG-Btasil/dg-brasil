import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/core/logger";
import { DriveClient, driveConfigFromEnv, type DriveConfig, type DriveFile } from "./client";
import { exportName, normalizeName, processExports, suggestLinks, syncLink, type DriveDbFunction, type SyncDeps } from "./sync";

const oauth: DriveConfig = { auth: { mode: "oauth", clientId: "cid", clientSecret: "sec", refreshToken: "rt" }, rootFolderId: "raizClientes_0001" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const md5 = (b: Uint8Array | string) => createHash("md5").update(b).digest("hex");

describe("configuração do Drive", () => {
  it("sem variáveis: não configurado; OAuth; conta de serviço (JSON ou base64)", () => {
    expect(driveConfigFromEnv({})).toBeNull();
    expect(driveConfigFromEnv({ GOOGLE_DRIVE_CLIENT_ID: "a", GOOGLE_DRIVE_CLIENT_SECRET: "b", GOOGLE_DRIVE_REFRESH_TOKEN: "c" })?.auth.mode).toBe("oauth");
    const sa = JSON.stringify({ client_email: "dg@proj.iam.gserviceaccount.com", private_key: "k" });
    expect(driveConfigFromEnv({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa })?.auth.mode).toBe("service_account");
    expect(driveConfigFromEnv({ GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: Buffer.from(sa).toString("base64"), GOOGLE_DRIVE_ROOT_FOLDER_ID: "raiz_0000001" })?.rootFolderId).toBe("raiz_0000001");
  });
});

describe("cliente do Drive", () => {
  it("OAuth: renova o token uma vez e reaproveita; a busca fica dentro da pasta raiz e escapa aspas", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("oauth2")) return json({ access_token: "tok", expires_in: 3600 });
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      return json({ files: [{ id: "pasta_000001", name: "JOSE D'AVILA" }] });
    });
    const c = new DriveClient(oauth, fetchFn as unknown as typeof fetch);
    await c.searchFolders("D'Avila");
    await c.searchFolders("x");
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes("oauth2"))).toHaveLength(1);
    const q = decodeURIComponent(String(fetchFn.mock.calls[1]![0]));
    expect(q).toContain("'raizClientes_0001' in parents");
    expect(q).toContain("name contains 'D\\'Avila'");
  });

  it("conta de serviço: assina o JWT (RS256) com a chave privada", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const cfg: DriveConfig = { auth: { mode: "service_account", clientEmail: "dg@x.iam", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() } };
    let assertion = "";
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("oauth2")) {
        assertion = new URLSearchParams(String(init?.body)).get("assertion") ?? "";
        return json({ access_token: "tok" });
      }
      return json({ user: { emailAddress: "dg@x.iam" } });
    });
    await new DriveClient(cfg, fetchFn as unknown as typeof fetch).about();
    const [h, c, s] = assertion.split(".");
    expect(JSON.parse(Buffer.from(c!, "base64url").toString())).toMatchObject({ iss: "dg@x.iam", scope: "https://www.googleapis.com/auth/drive" });
    expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });

  it("envio cria arquivo NOVO na pasta (multipart com parents); nunca chama permissões", async () => {
    let body = "";
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      if (String(url).includes("oauth2")) return json({ access_token: "tok" });
      body = Buffer.from(init?.body as Buffer).toString("utf8");
      return json({ id: "arquivoNovo_0001" });
    });
    const r = await new DriveClient(oauth, fetchFn as unknown as typeof fetch).upload("pasta_000001", "Procuração (v1, DG Brasil).pdf", "application/pdf", new TextEncoder().encode("%PDF"));
    expect(r.id).toBe("arquivoNovo_0001");
    expect(body).toContain('"parents":["pasta_000001"]');
    expect(urls.some((u) => u.includes("/permissions"))).toBe(false);
    expect(urls.some((u) => u.includes("uploadType=multipart"))).toBe(true);
  });

  it("pasta pública (qualquer pessoa com o link) é detectada; sem acesso às permissões: indeterminado", async () => {
    const mk = (perms: Response) => new DriveClient(oauth, (async (u: string | URL | Request) => (String(u).includes("oauth2") ? json({ access_token: "t" }) : perms)) as unknown as typeof fetch);
    expect(await mk(json({ permissions: [{ type: "user" }, { type: "anyone" }] })).isPublic("pasta_000001")).toBe(true);
    expect(await mk(json({ permissions: [{ type: "user" }] })).isPublic("pasta_000001")).toBe(false);
    expect(await mk(json({}, 403)).isPublic("pasta_000001")).toBeNull();
  });
});

function deps(over: Partial<SyncDeps> & { files?: DriveFile[]; bytes?: Uint8Array; known?: { imported: string[]; exported: string[] }; publicFolder?: boolean | null; pending?: unknown[] } = {}) {
  const calls: { fn: DriveDbFunction; args: unknown[] }[] = [];
  const uploaded: string[] = [];
  const driveUploads: string[] = [];
  const d: SyncDeps = {
    drive: {
      listFiles: async () => over.files ?? [],
      download: async () => over.bytes ?? new TextEncoder().encode("%PDF HISCON"),
      isPublic: async () => over.publicFolder ?? false,
      upload: async (_f: string, name: string) => { driveUploads.push(name); return { id: "arquivoNovo_0001" }; },
    } as unknown as DriveClient,
    db: async <T,>(fn: DriveDbFunction, args: unknown[]) => {
      calls.push({ fn, args });
      if (fn === "drive_known_files") return (over.known ?? { imported: [], exported: [] }) as T;
      if (fn === "drive_prepare_import") return { document_id: "d", document_version_id: "v", storage_object_name: "clients/c/documents/d/v/x.pdf" } as T;
      if (fn === "drive_claim_exports") return (over.pending ?? []) as T;
      return undefined as T;
    },
    storage: { uploadObject: async (n) => { uploaded.push(n); }, downloadObject: async () => new TextEncoder().encode("%PDF") },
    log: createLogger(),
    ...over,
  };
  return { d, calls, uploaded, driveUploads };
}

describe("sincronização (entrada)", () => {
  const pdf = new TextEncoder().encode("%PDF HISCON");
  const file = (over: Partial<DriveFile> = {}): DriveFile => ({ id: "arquivo_00001", name: "HISCON.pdf", mimeType: "application/pdf", md5Checksum: md5(pdf), size: pdf.length, ...over });

  it("importa arquivo novo: caminho do banco, bytes no Storage, registro com md5 e sha256", async () => {
    const { d, calls, uploaded } = setupWith({ files: [file()], bytes: pdf });
    const r = await syncLink({ id: "l1", client_id: "c1", folder_id: "pasta_000001" }, d);
    expect(r).toEqual({ imported: 1, skipped: 0, failed: 0 });
    expect(uploaded).toEqual(["clients/c/documents/d/v/x.pdf"]);
    const reg = calls.find((c) => c.fn === "drive_register_import")!;
    expect(reg.args.slice(0, 4)).toEqual(["l1", "arquivo_00001", md5(pdf), "HISCON.pdf"]);
    expect(reg.args[10]).toBe(createHash("sha256").update(pdf).digest("hex"));
    expect(calls.at(-1)).toEqual({ fn: "drive_mark_synced", args: ["l1", null] });
  });

  it("pula o já importado, o que o DG Brasil exportou, arquivo nativo do Google, tipo não aceito e grande demais", async () => {
    const { d, calls } = setupWith({
      files: [
        file({ id: "jaImportado_01" }), file({ id: "exportadoDG_01" }),
        file({ id: "docsGoogle_01", mimeType: "application/vnd.google-apps.document", md5Checksum: undefined }),
        file({ id: "executavel_01", mimeType: "application/x-msdownload" }), file({ id: "grande_000001", size: 60 * 1024 * 1024 }),
      ],
      known: { imported: [`jaImportado_01:${md5(pdf)}`], exported: ["exportadoDG_01"] },
    });
    const r = await syncLink({ id: "l1", client_id: "c1", folder_id: "pasta_000001" }, d);
    expect(r).toEqual({ imported: 0, skipped: 5, failed: 0 });
    expect(calls.some((c) => c.fn === "drive_register_import")).toBe(false);
  });

  it("arquivo que chega diferente do md5 do Drive não entra; o erro gravado não tem nome de arquivo", async () => {
    const { d, calls } = setupWith({ files: [file({ md5Checksum: "f".repeat(32) })], bytes: pdf });
    const r = await syncLink({ id: "l1", client_id: "c1", folder_id: "pasta_000001" }, d);
    expect(r.failed).toBe(1);
    const err = calls.at(-1)!.args[1] as string;
    expect(err).toMatch(/1 arquivo/);
    expect(err).not.toContain("HISCON");
  });

  function setupWith(o: Parameters<typeof deps>[0]) {
    return deps(o);
  }
});

describe("sincronização (saída)", () => {
  const pending = [{ id: "e1", folder_id: "pasta_000001", storage_object_name: "clients/c/x.pdf", filename: "procuracao.pdf", mime_type: "application/pdf", title: "Procuração", version_number: 2 }];

  it("envia como arquivo novo, com nome que identifica versão e origem, e grava o ID", async () => {
    const { d, calls, driveUploads } = deps({ pending });
    expect(await processExports(d)).toEqual({ exported: 1, failed: 0 });
    expect(driveUploads).toEqual(["Procuração (v2, DG Brasil).pdf"]);
    expect(calls.find((c) => c.fn === "drive_mark_export")!.args).toEqual(["e1", "arquivoNovo_0001", null]);
  });

  it("pasta pública: não envia; registra o motivo", async () => {
    const { d, calls, driveUploads } = deps({ pending, publicFolder: true });
    expect(await processExports(d)).toEqual({ exported: 0, failed: 1 });
    expect(driveUploads).toEqual([]);
    expect(String(calls.find((c) => c.fn === "drive_mark_export")!.args[2])).toMatch(/qualquer pessoa com o link/);
  });

  it("nome exportado sem caracteres proibidos no Drive/Windows", () => {
    expect(exportName({ title: 'Petição: "inicial"/BMG', version_number: 1, filename: "x.docx" })).toBe("Petição_ _inicial__BMG (v1, DG Brasil).docx");
  });
});

describe("sugestões de ligação (um humano confirma)", () => {
  it("casa nome igual ignorando acento, caixa e pontuação; senão, pasta que começa com o nome", () => {
    expect(normalizeName("José da Silva-Fictício")).toBe("JOSE DA SILVA FICTICIO");
    const s = suggestLinks(
      [{ client_id: "c1", name: "José da Silva" }, { client_id: "c2", name: "Maria Souza" }, { client_id: "c3", name: "Sem Pasta" }],
      [{ id: "p1", name: "JOSE DA SILVA" }, { id: "p2", name: "MARIA SOUZA - BMG" }, { id: "p3", name: "OUTRO" }],
    );
    expect(s).toEqual([
      { clientId: "c1", clientName: "José da Silva", folders: [{ id: "p1", name: "JOSE DA SILVA" }], exact: true },
      { clientId: "c2", clientName: "Maria Souza", folders: [{ id: "p2", name: "MARIA SOUZA - BMG" }], exact: false },
    ]);
  });
});
