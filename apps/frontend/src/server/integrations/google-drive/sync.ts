import { createHash } from "node:crypto";
import type { Logger } from "@/server/core/logger";
import { DriveError, type DriveClient, type DriveFile } from "./client";

/**
 * Sincronização com o Google Drive, rodada pelo SERVIDOR (rota agendada ou
 * "Sincronizar agora"). O banco decide o escopo (funções private.drive_*,
 * login dg_worker); o Storage é acessado só no caminho que o banco devolveu.
 *
 *  - Entrada: arquivo novo na pasta ligada (e subpastas, até 2 níveis) vira
 *    documento INTERNO do cliente. Pula: o que já foi importado (ID + md5), o
 *    que o próprio DG Brasil exportou, arquivo nativo do Google (Docs/Sheets,
 *    sem md5), tipo que o Storage não aceita e arquivo grande demais.
 *  - Saída: versões aprovadas na fila vão para a pasta do cliente como
 *    arquivo NOVO. Pasta compartilhada com "qualquer pessoa com o link": não
 *    envia (o arquivo ficaria público).
 *
 * Mensagens de erro gravadas no banco nunca levam nome de cliente nem de arquivo.
 */

export const IMPORT_MIME = new Set([
  "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain", "text/csv",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/tiff",
]);
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type DriveDbFunction =
  | "drive_links_to_sync" | "drive_known_files" | "drive_prepare_import" | "drive_register_import"
  | "drive_mark_synced" | "drive_claim_exports" | "drive_mark_export";
export const DRIVE_DB_FUNCTIONS: readonly DriveDbFunction[] = [
  "drive_links_to_sync", "drive_known_files", "drive_prepare_import", "drive_register_import",
  "drive_mark_synced", "drive_claim_exports", "drive_mark_export",
];

export interface SyncDeps {
  drive: DriveClient;
  db: <T>(fn: DriveDbFunction, args: unknown[]) => Promise<T>;
  storage: {
    uploadObject(objectName: string, bytes: Uint8Array, contentType: string): Promise<void>;
    downloadObject(objectName: string, maxBytes: number): Promise<Uint8Array>;
  };
  log: Logger;
  /** Parar de começar trabalho novo depois deste instante (ms). */
  deadline?: number;
  now?: () => number;
}

export interface LinkSyncResult {
  imported: number;
  skipped: number;
  failed: number;
}

interface Link {
  id: string;
  client_id: string;
  folder_id: string;
}

const time = (d: SyncDeps) => (d.now ?? Date.now)();
const outOfTime = (d: SyncDeps) => d.deadline !== undefined && time(d) > d.deadline;

export async function syncLink(link: Link, d: SyncDeps, maxImports = 30): Promise<LinkSyncResult> {
  const result: LinkSyncResult = { imported: 0, skipped: 0, failed: 0 };
  let error: string | null = null;
  try {
    const known = await d.db<{ imported: string[]; exported: (string | null)[] }>("drive_known_files", [link.id]);
    const imported = new Set(known.imported);
    const exported = new Set(known.exported.filter(Boolean));
    const files = await d.drive.listFiles(link.folder_id, 2, 500);
    for (const f of files) {
      if (!importable(f) || imported.has(`${f.id}:${f.md5Checksum}`) || exported.has(f.id)) {
        result.skipped++;
        continue;
      }
      if (result.imported >= maxImports || outOfTime(d)) break;
      try {
        await importFile(link, f, d);
        result.imported++;
      } catch (e) {
        result.failed++;
        d.log.warn("drive.import_failed", { folderLinkId: link.id, status: e instanceof DriveError ? e.status : 0 });
      }
    }
    if (result.failed) error = `${result.failed} arquivo(s) não importado(s) nesta rodada; nova tentativa na próxima.`;
  } catch (e) {
    error = e instanceof DriveError ? e.message : "Falha ao ler a pasta do Drive.";
    d.log.warn("drive.sync_failed", { folderLinkId: link.id, status: e instanceof DriveError ? e.status : 0 });
  }
  await d.db("drive_mark_synced", [link.id, error]);
  return result;
}

function importable(f: DriveFile): boolean {
  return !!f.md5Checksum && /^[0-9a-f]{32}$/.test(f.md5Checksum) && IMPORT_MIME.has(f.mimeType) && (f.size ?? 0) > 0 && (f.size ?? 0) <= MAX_FILE_BYTES;
}

async function importFile(link: Link, f: DriveFile, d: SyncDeps) {
  const bytes = await d.drive.download(f.id, MAX_FILE_BYTES);
  const md5 = createHash("md5").update(bytes).digest("hex");
  if (md5 !== f.md5Checksum) throw new DriveError(409, "md5 diferente do informado pelo Drive");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = f.name.slice(0, 200);
  const prep = await d.db<{ document_id: string; document_version_id: string; storage_object_name: string }>("drive_prepare_import", [link.id, name]);
  await d.storage.uploadObject(prep.storage_object_name, bytes, f.mimeType);
  await d.db("drive_register_import", [
    link.id, f.id, f.md5Checksum, name, f.modifiedTime ?? null, prep.document_id, prep.document_version_id,
    prep.storage_object_name, f.mimeType, bytes.byteLength, sha256,
  ]);
}

export interface ExportResult {
  exported: number;
  failed: number;
}

interface PendingExport {
  id: string;
  folder_id: string;
  storage_object_name: string;
  filename: string;
  mime_type: string | null;
  title: string;
  version_number: number;
}

/** Nome do arquivo no Drive: título + versão, para nunca confundir com o original. */
export function exportName(e: Pick<PendingExport, "title" | "version_number" | "filename">): string {
  const dot = e.filename.lastIndexOf(".");
  const ext = dot > 0 ? e.filename.slice(dot) : "";
  const base = e.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 150);
  return `${base} (v${e.version_number}, DG Brasil)${ext}`;
}

export async function processExports(d: SyncDeps, limit = 5): Promise<ExportResult> {
  const result: ExportResult = { exported: 0, failed: 0 };
  if (outOfTime(d)) return result;
  const pending = await d.db<PendingExport[]>("drive_claim_exports", [limit]);
  const publicFolder = new Map<string, boolean | null>();
  for (const e of pending) {
    try {
      if (!publicFolder.has(e.folder_id)) publicFolder.set(e.folder_id, await d.drive.isPublic(e.folder_id));
      if (publicFolder.get(e.folder_id) === true) {
        await d.db("drive_mark_export", [e.id, null, "A pasta do cliente está compartilhada com qualquer pessoa com o link. Tire o compartilhamento público no Drive."]);
        result.failed++;
        continue;
      }
      const bytes = await d.storage.downloadObject(e.storage_object_name, MAX_FILE_BYTES);
      const up = await d.drive.upload(e.folder_id, exportName(e), e.mime_type ?? "application/octet-stream", bytes);
      await d.db("drive_mark_export", [e.id, up.id, null]);
      result.exported++;
    } catch (err) {
      await d.db("drive_mark_export", [e.id, null, err instanceof DriveError ? err.message : "Falha ao enviar ao Drive."]);
      result.failed++;
      d.log.warn("drive.export_failed", { exportId: e.id, status: err instanceof DriveError ? err.status : 0 });
    }
  }
  return result;
}

/** Uma rodada completa (rota agendada): exportações primeiro, depois as pastas mais antigas. */
export async function runDriveSync(d: SyncDeps, opts: { links?: number; clientId?: string } = {}) {
  const exports = await processExports(d);
  const links = await d.db<Link[]>("drive_links_to_sync", [opts.links ?? 5, opts.clientId ?? null]);
  const totals: LinkSyncResult = { imported: 0, skipped: 0, failed: 0 };
  for (const l of links) {
    if (outOfTime(d)) break;
    const r = await syncLink(l, d);
    totals.imported += r.imported;
    totals.skipped += r.skipped;
    totals.failed += r.failed;
  }
  return { exports, links: links.length, ...totals };
}

/** Normaliza nome para casar cliente ↔ pasta (sugestão; um humano confirma). */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Sugestões: pasta cujo nome normalizado é igual ao do cliente, ou começa com ele. */
export function suggestLinks(clients: { client_id: string; name: string }[], folders: { id: string; name: string }[]) {
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const f of folders) {
    const k = normalizeName(f.name);
    byName.set(k, [...(byName.get(k) ?? []), f]);
  }
  return clients.map((c) => {
    const n = normalizeName(c.name);
    const exact = byName.get(n) ?? [];
    const starts = exact.length ? [] : folders.filter((f) => normalizeName(f.name).startsWith(`${n} `)).slice(0, 3);
    const candidates = exact.length ? exact : starts;
    return { clientId: c.client_id, clientName: c.name, folders: candidates.slice(0, 3), exact: exact.length === 1 };
  }).filter((s) => s.folders.length > 0);
}
