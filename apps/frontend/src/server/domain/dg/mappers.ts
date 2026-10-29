import type { AgentStatus } from "@/lib/constants/status";
import type { DiffLine } from "@/types";
import type { AgentConfigInput } from "./schemas";

/** Banco ↔ domínio da área DG Brasil. Funções puras (testadas em dg.test.ts). */

/** Situação do agente: a tela diz "Pausado", o banco guarda INACTIVE. */
export const agentStatusToDb = (s: AgentStatus) => (s === "PAUSED" ? "INACTIVE" : s);
export const agentStatusFromDb = (s: string): AgentStatus => (s === "INACTIVE" ? "PAUSED" : s === "ACTIVE" ? "ACTIVE" : "DRAFT");

/**
 * agent_versions.configuration → formulário. Na execução pelo escritório só
 * conta o agente local do Claude Code (local_agent). Chaves antigas da Claude
 * API (modelo, esforço, limites) ficam no histórico das versões.
 */
export function configFromDb(raw: unknown): AgentConfigInput {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { localAgent: typeof c.local_agent === "string" ? c.local_agent : "" };
}

/** Formulário → agent_versions.configuration (contrato 040). */
export function configToDb(c: AgentConfigInput): Record<string, unknown> {
  return { local_agent: c.localAgent };
}

/** Identificador estável a partir do nome (sem acento, minúsculo, hífen). */
export function slugify(name: string, suffix?: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/(anthropic|claude)/g, "x")
    .slice(0, 50) || "item";
  const s = suffix ? `${base}-${suffix}` : base;
  return /^[a-z0-9]/.test(s) ? s : `a${s}`.slice(0, 63);
}

const MAX_DIFF_LINES = 4000;

/** Diferença por linha (LCS). Texto grande demais vira um aviso, não trava a tela. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (a.length + b.length > MAX_DIFF_LINES) {
    return [{ type: "context", text: `(texto grande demais para comparar aqui: ${a.length} → ${b.length} linhas)` }];
  }
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ type: "removed", text: a[i++]! });
    } else {
      out.push({ type: "added", text: b[j++]! });
    }
  }
  while (i < n) out.push({ type: "removed", text: a[i++]! });
  while (j < m) out.push({ type: "added", text: b[j++]! });
  return compactContext(out);
}

/** Mantém só 2 linhas de contexto em volta das mudanças. */
function compactContext(lines: DiffLine[], keep = 2): DiffLine[] {
  const near = lines.map((_, idx) => lines.slice(Math.max(0, idx - keep), idx + keep + 1).some((l) => l.type !== "context"));
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (l.type !== "context" || near[idx]) {
      if (skipped) out.push({ type: "context", text: `… ${skipped} linha(s) sem alteração` });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ type: "context", text: `… ${skipped} linha(s) sem alteração` });
  return out;
}

/** Texto canônico de uma versão de tese, para comparar versões. */
export function thesisText(v: { foundations?: string | null; application_criteria?: string | null; exclusion_criteria?: string | null; notes?: string | null }): string {
  return [
    "# Fundamentos", v.foundations ?? "",
    "# Critérios de aplicação", v.application_criteria ?? "",
    "# Critérios de exclusão", v.exclusion_criteria ?? "",
    "# Observações", v.notes ?? "",
  ].join("\n");
}

/** Texto canônico de uma versão de agente (instruções + configuração). */
export function agentVersionText(v: { instructions: string; configuration: unknown }): string {
  return `${v.instructions}\n\n# Configuração\n${JSON.stringify(v.configuration ?? {}, null, 2)}`;
}

/** Texto canônico de uma versão de skill (instruções + lista de arquivos). */
export function skillVersionText(v: { instructions: string }, files: { path: string; checksum_sha256: string }[]): string {
  return `${v.instructions}\n\n# Arquivos\n${files.map((f) => `${f.path} (${f.checksum_sha256.slice(0, 12)})`).join("\n")}`;
}
