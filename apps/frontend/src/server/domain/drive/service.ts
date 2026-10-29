import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireInternal, requireRole, type ServiceContext } from "@/server/core/context";
import { unwrap } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";
import { callPrivate } from "@/server/core/worker-db";
import { signedDocumentStorage } from "@/server/domain/documents/signed-storage";
import { DriveClient, DriveError, driveConfigFromEnv } from "@/server/integrations/google-drive/client";
import { DRIVE_DB_FUNCTIONS, runDriveSync, suggestLinks, type DriveDbFunction, type SyncDeps } from "@/server/integrations/google-drive/sync";
import type { ClientDriveDTO, DriveFolderDTO, DriveStatusDTO, DriveSuggestionDTO, DriveSyncResultDTO } from "./dto";

/**
 * Google Drive do escritório (041). A credencial do Google fica só no
 * servidor (variáveis GOOGLE_DRIVE_*). Ligar/desligar pasta e ler a situação:
 * RPCs com o JWT do usuário (o banco confere papel e acesso ao cliente).
 * Sincronizar: servidor, com o login dg_worker e o Storage só no caminho que
 * o banco devolveu.
 */

const rpc = async <T>(db: SupabaseClient, fn: string, args: Record<string, unknown> = {}) => unwrap(await db.rpc(fn, args)) as T;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

function client(): DriveClient | null {
  const cfg = driveConfigFromEnv();
  return cfg ? new DriveClient(cfg) : null;
}

function requireClient(): DriveClient {
  const c = client();
  if (!c) throw new DomainError("INVALID_STATE", "O Google Drive ainda não foi configurado no servidor (variáveis GOOGLE_DRIVE_*).");
  return c;
}

function fromDrive(e: unknown): never {
  if (e instanceof DriveError) throw new DomainError("INVALID_STATE", e.message);
  throw e;
}

export function syncDeps(ctx: Pick<ServiceContext, "log">, drive: DriveClient, deadline?: number): SyncDeps {
  const storage = signedDocumentStorage();
  return {
    drive,
    db: <T>(fn: DriveDbFunction, args: unknown[]) => callPrivate<T>(DRIVE_DB_FUNCTIONS, fn, args),
    storage: {
      uploadObject: (name, bytes, type) => storage.uploadObject(name, bytes, type),
      downloadObject: (name, max) => storage.downloadObject(name, max),
    },
    log: ctx.log,
    deadline,
  };
}

export async function getDriveStatus(ctx: ServiceContext): Promise<DriveStatusDTO> {
  requireInternal(ctx);
  const cfg = (() => { try { return driveConfigFromEnv(); } catch { return null; } })();
  const s = await rpc<Record<string, unknown>>(ctx.db, "get_drive_summary");
  return {
    configured: !!cfg,
    mode: cfg?.auth.mode,
    rootFolderConfigured: !!cfg?.rootFolderId,
    linkedClients: Number(s.linked_clients ?? 0),
    imports: Number(s.imports ?? 0),
    exportsPending: Number(s.exports_pending ?? 0),
    exportsFailed: Number(s.exports_failed ?? 0),
    lastSyncAt: str(s.last_sync_at),
    syncErrors: Number(s.sync_errors ?? 0),
  };
}

/** "Testar conexão" (ADMIN): entra no Drive e confere a pasta raiz. */
export async function testDrive(ctx: ServiceContext): Promise<{ email?: string; rootFolderName?: string }> {
  requireRole(ctx, "ADMIN");
  const c = requireClient();
  try {
    const about = await c.about();
    const root = c.rootFolderId ? await c.folder(c.rootFolderId) : undefined;
    return { email: about.email, rootFolderName: root?.name };
  } catch (e) {
    return fromDrive(e);
  }
}

export async function searchFolders(ctx: ServiceContext, term: string): Promise<DriveFolderDTO[]> {
  requireRole(ctx, "ADMIN", "LAWYER");
  try {
    return (await requireClient().searchFolders(term)).map((f) => ({ id: f.id, name: f.name }));
  } catch (e) {
    return fromDrive(e);
  }
}

export async function getClientDrive(ctx: ServiceContext, clientId: string): Promise<ClientDriveDTO> {
  requireInternal(ctx);
  const r = await rpc<Record<string, unknown>>(ctx.db, "get_client_drive", { p_client_id: clientId });
  const l = r.link as Record<string, unknown> | null;
  const ex = (r.exports ?? {}) as Record<string, unknown>;
  return {
    configured: !!client(),
    link: l ? {
      id: String(l.id), folderId: String(l.folder_id), folderName: str(l.folder_name), folderUrl: folderUrl(String(l.folder_id)),
      linkedAt: String(l.linked_at), lastSyncedAt: str(l.last_synced_at), lastSyncError: str(l.last_sync_error),
    } : undefined,
    imports: Number(r.imports ?? 0),
    recentImports: Array.isArray(r.recent_imports)
      ? (r.recent_imports as Record<string, unknown>[]).map((i) => ({ name: String(i.name ?? ""), at: String(i.at), documentVersionId: String(i.document_version_id) }))
      : [],
    exports: { pending: Number(ex.pending ?? 0), exported: Number(ex.exported ?? 0), failed: Number(ex.failed ?? 0) },
  };
}

/**
 * Liga a pasta (pelo ID) ao cliente. Antes, confere no Drive que é uma pasta
 * ativa e que NÃO está aberta a "qualquer pessoa com o link".
 */
export async function linkFolder(ctx: ServiceContext, clientId: string, folderId: string): Promise<void> {
  requireRole(ctx, "ADMIN", "LAWYER");
  const c = requireClient();
  let name: string;
  try {
    const f = await c.folder(folderId);
    if ((await c.isPublic(folderId)) === true) {
      throw new DomainError("INVALID_STATE", "Esta pasta está compartilhada com qualquer pessoa com o link. Tire o compartilhamento público no Drive antes de ligar.");
    }
    name = f.name;
  } catch (e) {
    return fromDrive(e);
  }
  await rpc(ctx.db, "drive_link_client_folder", { p_client_id: clientId, p_folder_id: folderId, p_folder_name: name });
  ctx.log.info("drive.folder_linked", { clientId });
}

export async function unlinkFolder(ctx: ServiceContext, clientId: string): Promise<void> {
  requireRole(ctx, "ADMIN", "LAWYER");
  await rpc(ctx.db, "drive_unlink_client_folder", { p_client_id: clientId });
  ctx.log.info("drive.folder_unlinked", { clientId });
}

/** "Sincronizar agora" de um cliente (o banco confere o acesso antes). */
export async function syncClientNow(ctx: ServiceContext, clientId: string): Promise<DriveSyncResultDTO> {
  requireRole(ctx, "ADMIN", "LAWYER");
  const current = await getClientDrive(ctx, clientId);
  if (!current.link) throw new DomainError("INVALID_STATE", "Este cliente não tem pasta do Drive ligada.");
  const r = await runDriveSync(syncDeps(ctx, requireClient(), Date.now() + 40_000), { links: 1, clientId });
  return { imported: r.imported, skipped: r.skipped, failed: r.failed, exported: r.exports.exported };
}

/** Sugestões de ligação: clientes sem pasta × pastas da raiz com o mesmo nome. Um humano confirma cada uma. */
export async function suggestions(ctx: ServiceContext): Promise<DriveSuggestionDTO[]> {
  requireRole(ctx, "ADMIN", "LAWYER");
  const c = requireClient();
  if (!c.rootFolderId) throw new DomainError("INVALID_STATE", "Configure GOOGLE_DRIVE_ROOT_FOLDER_ID (a pasta que contém as pastas dos clientes).");
  const [clients, folders] = await Promise.all([
    rpc<{ client_id: string; name: string }[]>(ctx.db, "drive_unlinked_clients", { p_limit: 1000 }),
    c.listClientFolders().catch(fromDrive),
  ]);
  return suggestLinks(clients, folders).slice(0, 200);
}
