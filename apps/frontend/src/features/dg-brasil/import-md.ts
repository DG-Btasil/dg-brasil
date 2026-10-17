/**
 * Importa o formato de agente/skill do Claude Code: arquivo Markdown com
 * cabeçalho YAML simples (`---` … `---`) e o corpo com as instruções.
 *
 *   ---
 *   name: lucas-procuracao
 *   description: Lucas · Kit de documentos...
 *   model: sonnet
 *   tools: Read, Write, ...
 *   ---
 *   **Você é Lucas**...
 *
 * Só nome, descrição e corpo são aproveitados. `tools` e `model` do Claude
 * Code NÃO são copiados: no DG Brasil as ferramentas são as do catálogo
 * (sem shell, sem acesso livre a arquivo) e o modelo é escolhido na tela.
 */
export interface ImportedMarkdown {
  name?: string;
  description?: string;
  body: string;
  /** Campos do cabeçalho ignorados (para avisar quem importou). */
  ignored: string[];
}

export function parseMarkdownWithFrontmatter(text: string): ImportedMarkdown {
  const normalized = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!m) return { body: normalized.trim(), ignored: [] };
  const header = m[1] ?? "";
  const out: ImportedMarkdown = { body: (m[2] ?? "").trim(), ignored: [] };
  for (const line of header.split("\n")) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.toLowerCase();
    const value = unquote((kv[2] ?? "").trim());
    if (key === "name") out.name = value;
    else if (key === "description") out.description = value;
    else out.ignored.push(key);
  }
  return out;
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try {
      return v.startsWith('"') ? (JSON.parse(v) as string) : v.slice(1, -1);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

/** Nome legível a partir do identificador (lucas-procuracao → Lucas procuracao). */
export function nameFromSlug(slug: string): string {
  const s = slug.replace(/[-_]+/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
