"use client";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SKILL_FILE_MAX_BYTES, SKILL_FILE_PATH, SKILL_FILES_TOTAL_MAX_BYTES, skillFileMime } from "@/lib/constants/ai";
import type { PreparedFileDTO } from "@/server/domain/dg/dto";

/**
 * Envio de arquivo da área DG Brasil (skills e referências), pelo mesmo
 * padrão dos documentos: o SERVIDOR monta o caminho e assina a URL; o
 * navegador só envia os bytes para ela (write-once). O checksum vai junto e
 * o worker confere antes de usar.
 */

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putSigned(prepared: PreparedFileDTO, file: Blob): Promise<string | undefined> {
  try {
    const { error } = await getSupabaseBrowserClient()
      .storage.from(prepared.bucket)
      .uploadToSignedUrl(prepared.storageObjectName, prepared.token, file, { contentType: prepared.mimeType, upsert: false });
    return error ? "Não foi possível enviar o arquivo. Verifique a conexão e tente de novo." : undefined;
  } catch {
    return "Sem conexão com o servidor. Verifique a internet e tente novamente.";
  }
}

export interface PendingSkillFile {
  path: string;
  file: File;
}

/**
 * Arquivos escolhidos (um a um ou a pasta inteira da skill) → caminhos dentro
 * da skill. Pasta: tira o nome da pasta raiz (`kit/scripts/a.py` → `scripts/a.py`).
 * SKILL.md volta separado (vira as instruções); arquivos ocultos são ignorados.
 */
export function toSkillFiles(files: FileList | File[]): { files: PendingSkillFile[]; skillMd?: File; skipped: string[] } {
  const list = Array.from(files);
  const out: PendingSkillFile[] = [];
  const skipped: string[] = [];
  let skillMd: File | undefined;
  for (const file of list) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = rel.split("/").filter(Boolean);
    const path = (parts.length > 1 ? parts.slice(1) : parts).join("/");
    if (!path || parts.some((p) => p.startsWith(".")) || /(^|\/)__pycache__(\/|$)/.test(path)) {
      skipped.push(rel);
      continue;
    }
    if (path.toLowerCase() === "skill.md") {
      skillMd = file;
      continue;
    }
    out.push({ path, file });
  }
  return { files: out, skillMd, skipped };
}

/** Problema com um arquivo de skill (antes de pedir qualquer coisa ao servidor). */
export function skillFileProblem(f: PendingSkillFile): string | undefined {
  if (!SKILL_FILE_PATH.test(f.path) || f.path.length > 200) return `${f.path}: nome ou pasta inválidos (use letras, números, ponto, hífen e sublinhado).`;
  if (!skillFileMime(f.path)) return `${f.path}: tipo de arquivo não aceito.`;
  if (f.file.size <= 0) return `${f.path}: arquivo vazio.`;
  if (f.file.size > SKILL_FILE_MAX_BYTES) return `${f.path}: maior que 10 MB.`;
  return undefined;
}

export function totalTooLarge(sizes: number[]): boolean {
  return sizes.reduce((a, b) => a + b, 0) > SKILL_FILES_TOTAL_MAX_BYTES;
}
