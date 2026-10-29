import { createSign } from "node:crypto";

/**
 * Cliente mínimo da API do Google Drive (v3), com fetch. Só o que o DG Brasil
 * usa: procurar pastas, ler a permissão da pasta, listar arquivos, baixar e
 * enviar arquivo novo. Nunca cria permissão, nunca apaga, nunca sobrescreve.
 *
 * Duas formas de entrar, conforme a conta do escritório (só uma por vez):
 *  - Gmail pessoal (ou usuário de Workspace): OAuth com token de renovação
 *    (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN).
 *  - Google Workspace com Drive compartilhado: conta de serviço
 *    (GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON). Conta de serviço não tem cota para
 *    gravar no "Meu Drive" de uma pessoa: use com Drive compartilhado.
 * GOOGLE_DRIVE_ROOT_FOLDER_ID: a pasta que contém as pastas dos clientes.
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FOLDER = "application/vnd.google-apps.folder";
const ALL = "supportsAllDrives=true&includeItemsFromAllDrives=true";

export type DriveAuth =
  | { mode: "oauth"; clientId: string; clientSecret: string; refreshToken: string }
  | { mode: "service_account"; clientEmail: string; privateKey: string };

export interface DriveConfig {
  auth: DriveAuth;
  rootFolderId?: string;
}

export class DriveError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  md5Checksum?: string;
  size?: number;
  modifiedTime?: string;
}

/** Configuração a partir do ambiente; null = Drive não configurado. */
export function driveConfigFromEnv(env: Record<string, string | undefined> = process.env): DriveConfig | null {
  const rootFolderId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() || undefined;
  const sa = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON?.trim();
  if (sa) {
    let raw = sa;
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf8");
    const j = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!j.client_email || !j.private_key) throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON sem client_email/private_key");
    return { auth: { mode: "service_account", clientEmail: j.client_email, privateKey: j.private_key }, rootFolderId };
  }
  const { GOOGLE_DRIVE_CLIENT_ID: clientId, GOOGLE_DRIVE_CLIENT_SECRET: clientSecret, GOOGLE_DRIVE_REFRESH_TOKEN: refreshToken } = env;
  if (clientId && clientSecret && refreshToken) return { auth: { mode: "oauth", clientId, clientSecret, refreshToken }, rootFolderId };
  return null;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export class DriveClient {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: DriveConfig, private readonly fetchFn: typeof fetch = fetch, private readonly now = () => Date.now()) {}

  get rootFolderId() {
    return this.config.rootFolderId;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const a = this.config.auth;
    let body: URLSearchParams;
    if (a.mode === "oauth") {
      body = new URLSearchParams({ client_id: a.clientId, client_secret: a.clientSecret, refresh_token: a.refreshToken, grant_type: "refresh_token" });
    } else {
      const iat = Math.floor(this.now() / 1000);
      const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
        iss: a.clientEmail, scope: DRIVE_SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600,
      }))}`;
      const signature = createSign("RSA-SHA256").update(unsigned).sign(a.privateKey).toString("base64url");
      body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` });
    }
    const r = await this.fetchFn(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new DriveError(r.status, "Não foi possível entrar no Google Drive (credencial inválida ou revogada).");
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    this.token = { value: j.access_token, expiresAt: this.now() + (j.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const r = await this.fetchFn(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${await this.accessToken()}` },
      signal: init.signal ?? AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const msg = r.status === 404 ? "Pasta ou arquivo não encontrado no Drive (ou sem acesso)." : r.status === 403 ? "Sem permissão no Drive." : `O Google Drive respondeu ${r.status}.`;
      throw new DriveError(r.status, msg);
    }
    return r;
  }

  /** Conta conectada (para "Testar conexão"). */
  async about(): Promise<{ email?: string }> {
    const j = (await (await this.call(`${API}/about?fields=user(emailAddress)`)).json()) as { user?: { emailAddress?: string } };
    return { email: j.user?.emailAddress };
  }

  /** Pastas dentro da pasta raiz dos clientes (ou em todo o Drive, sem raiz), por parte do nome. */
  async searchFolders(term: string, limit = 25): Promise<{ id: string; name: string }[]> {
    const parts = [`mimeType = '${FOLDER}'`, "trashed = false"];
    if (this.config.rootFolderId) parts.push(`'${quote(this.config.rootFolderId)}' in parents`);
    if (term.trim()) parts.push(`name contains '${quote(term.trim().slice(0, 100))}'`);
    const q = encodeURIComponent(parts.join(" and "));
    const j = (await (await this.call(`${API}/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=${Math.min(limit, 100)}&${ALL}`)).json()) as { files?: { id: string; name: string }[] };
    return j.files ?? [];
  }

  /** Todas as pastas da raiz (para sugerir ligações). Até `max`. */
  async listClientFolders(max = 2000): Promise<{ id: string; name: string }[]> {
    if (!this.config.rootFolderId) return [];
    const out: { id: string; name: string }[] = [];
    let page: string | undefined;
    do {
      const q = encodeURIComponent(`mimeType = '${FOLDER}' and trashed = false and '${quote(this.config.rootFolderId)}' in parents`);
      const j = (await (await this.call(`${API}/files?q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000&${ALL}${page ? `&pageToken=${page}` : ""}`)).json()) as {
        files?: { id: string; name: string }[]; nextPageToken?: string;
      };
      out.push(...(j.files ?? []));
      page = j.nextPageToken;
    } while (page && out.length < max);
    return out.slice(0, max);
  }

  async folder(id: string): Promise<{ id: string; name: string; webViewLink?: string }> {
    const j = (await (await this.call(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,trashed,webViewLink&supportsAllDrives=true`)).json()) as {
      id: string; name: string; mimeType: string; trashed?: boolean; webViewLink?: string;
    };
    if (j.mimeType !== FOLDER || j.trashed) throw new DriveError(404, "Não é uma pasta ativa do Drive.");
    return { id: j.id, name: j.name, webViewLink: j.webViewLink };
  }

  /** true = qualquer pessoa com o link vê a pasta. Sem como ler as permissões: null. */
  async isPublic(id: string): Promise<boolean | null> {
    try {
      const j = (await (await this.call(`${API}/files/${encodeURIComponent(id)}/permissions?fields=permissions(type,role)&supportsAllDrives=true`)).json()) as {
        permissions?: { type: string }[];
      };
      return (j.permissions ?? []).some((p) => p.type === "anyone");
    } catch (e) {
      if (e instanceof DriveError && (e.status === 403 || e.status === 404)) return null;
      throw e;
    }
  }

  /** Arquivos da pasta e das subpastas (até `depth` níveis), sem pastas nem lixeira. */
  async listFiles(folderId: string, depth = 2, max = 500): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    const queue: { id: string; level: number }[] = [{ id: folderId, level: 0 }];
    while (queue.length && out.length < max) {
      const { id, level } = queue.shift()!;
      let page: string | undefined;
      do {
        const q = encodeURIComponent(`'${quote(id)}' in parents and trashed = false`);
        const j = (await (await this.call(`${API}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,md5Checksum,size,modifiedTime)&pageSize=200&${ALL}${page ? `&pageToken=${page}` : ""}`)).json()) as {
          files?: (Omit<DriveFile, "size"> & { size?: string })[]; nextPageToken?: string;
        };
        for (const f of j.files ?? []) {
          if (f.mimeType === FOLDER) {
            if (level + 1 <= depth) queue.push({ id: f.id, level: level + 1 });
          } else {
            out.push({ ...f, size: f.size !== undefined ? Number(f.size) : undefined });
          }
        }
        page = j.nextPageToken;
      } while (page && out.length < max);
    }
    return out.slice(0, max);
  }

  async download(fileId: string, maxBytes: number): Promise<Uint8Array> {
    const r = await this.call(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { signal: AbortSignal.timeout(120_000) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new DriveError(413, "Arquivo do Drive maior que o limite.");
    return bytes;
  }

  /** Cria um arquivo NOVO na pasta (nunca sobrescreve). */
  async upload(folderId: string, name: string, mimeType: string, bytes: Uint8Array): Promise<{ id: string }> {
    const boundary = `dgbrasil${Date.now().toString(36)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folderId] })}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    );
    const body = Buffer.concat([head, Buffer.from(bytes), Buffer.from(`\r\n--${boundary}--`)]);
    const r = await this.call(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
      method: "POST",
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(120_000),
    });
    return (await r.json()) as { id: string };
  }
}
