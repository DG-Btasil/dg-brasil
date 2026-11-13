import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { actionLabel, AUDIT_ACTION_LABEL, AUDIT_FIELD_LABEL, changedFieldsText, eventDetail, hasActionLabel, PREFIX_LABEL } from "./humanize";

/**
 * Toda ação que o banco grava na auditoria precisa de rótulo em português.
 * Este teste lê as migrations, acha as chamadas a `record_audit_event` e falha
 * quando aparece ação sem rótulo (sem ele, a tela mostra "Executor revoked").
 * Migration nova com ação nova: acrescente a linha em AUDIT_ACTION_LABEL.
 */

const MIGRATIONS = resolve(__dirname, "../../../../../supabase/migrations");

/** Primeiro argumento de cada chamada a record_audit_event (sem comentários de linha). */
function firstArguments(sql: string): string[] {
  const clean = sql.replace(/--[^\n]*/g, "");
  const out: string[] = [];
  for (const match of clean.matchAll(/record_audit_event\s*\(/g)) {
    let i = match.index + match[0].length;
    const start = i;
    let depth = 0;
    let quoted = false;
    for (; i < clean.length; i += 1) {
      const c = clean[i];
      if (c === "'") quoted = !quoted;
      else if (!quoted) {
        if (c === "(") depth += 1;
        else if (c === ")") {
          if (depth === 0) break;
          depth -= 1;
        } else if (c === "," && depth === 0) break;
      }
    }
    out.push(clean.slice(start, i).replace(/\s+/g, " ").trim());
  }
  return out;
}

interface Found {
  /** Ações completas (literal puro, ou resultado de `then`/`else` de um CASE). */
  actions: Set<string>;
  /** Prefixos de ação montada em tempo de execução ('PREFIXO_' || situação). */
  prefixes: Set<string>;
}

function actionsInMigrations(): Found {
  const found: Found = { actions: new Set(), prefixes: new Set() };
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    for (const arg of firstArguments(sql)) {
      // Declaração da própria função (p_action text) e repasse de parâmetro: sem literal.
      const pure = arg.match(/^'([A-Z][A-Z0-9_]*)'$/);
      if (pure) {
        found.actions.add(pure[1]);
        continue;
      }
      for (const m of arg.matchAll(/'([A-Z][A-Z0-9_]*_)'\s*\|\|/g)) found.prefixes.add(m[1]);
      for (const m of arg.matchAll(/\b(?:then|else)\s+'([A-Z][A-Z0-9_]*)'/g)) found.actions.add(m[1]);
    }
    // Funções que repassam a ação recebida conferem a lista permitida antes.
    for (const m of sql.matchAll(/p_action not in \(([^)]*)\)/g)) {
      for (const lit of m[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)) found.actions.add(lit[1]);
    }
  }
  return found;
}

describe("rótulos das ações de auditoria", () => {
  const found = actionsInMigrations();

  it("o leitor das migrations encontra as ações (não passa por estar vazio)", () => {
    expect(found.actions.size).toBeGreaterThan(120);
    for (const known of ["CLIENT_CREATED", "CASE_STATUS_OVERRIDDEN", "EXECUTOR_REVOKED", "PASSWORD_CHANGED", "PROCESS_EXPENSE_CANCELLED"]) expect(found.actions).toContain(known);
    expect([...found.prefixes].sort()).toEqual(expect.arrayContaining(["AGENT_RUN_", "IMPORT_JOB_", "JUDICIAL_PUBLICATION_"]));
  });

  it("toda ação gravada pelas migrations tem rótulo próprio", () => {
    const missing = [...found.actions].filter((a) => !(a in AUDIT_ACTION_LABEL)).sort();
    expect(missing).toEqual([]);
  });

  it("todo prefixo de ação com sufixo dinâmico tem rótulo de reserva", () => {
    const known = PREFIX_LABEL.map(([p]) => p);
    expect([...found.prefixes].filter((p) => !known.includes(p)).sort()).toEqual([]);
  });

  it("situações conhecidas das ações com sufixo dinâmico têm rótulo próprio", () => {
    const expected = [
      ...["QUEUED", "RUNNING", "WAITING_HUMAN", "COMPLETED", "FAILED", "CANCELLED"].map((s) => `AGENT_RUN_${s}`),
      ...["PENDING", "APPROVED", "REJECTED", "APPLIED", "FAILED"].map((s) => `AGENT_PROPOSAL_${s}`),
      ...["OPEN", "ANSWERED", "RESOLVED", "CANCELLED"].map((s) => `PARTNER_REQUEST_${s}`),
      ...["UPLOADED", "COLUMNS_DETECTED", "MAPPED", "VALIDATED", "CONFLICTS_PENDING", "CONFIRMED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"].map((s) => `IMPORT_JOB_${s}`),
      ...["DEADLINE", "NO_DEADLINE", "REOPEN"].map((s) => `JUDICIAL_PUBLICATION_${s}`),
      // Gatilho geral do Roadmap 2.0 (046): NOME_DA_TABELA + operação.
      "PROCESS_TASKS_INSERT",
      "PROCESS_TASKS_UPDATE",
    ];
    expect(expected.filter((a) => !(a in AUDIT_ACTION_LABEL))).toEqual([]);
  });

  it("nenhum rótulo se repete (o filtro de auditoria lista um por ação)", () => {
    const labels = Object.values(AUDIT_ACTION_LABEL);
    const repeated = labels.filter((l, i) => labels.indexOf(l) !== i);
    expect(repeated).toEqual([]);
  });

  it("ações que saíam em inglês agora saem em português", () => {
    expect(actionLabel("AI_EXECUTION_DISABLED")).toBe("Execução dos agentes desligada");
    expect(actionLabel("EXECUTOR_REVOKED")).toBe("Computador do escritório revogado");
    expect(actionLabel("AGENT_RUN_COMPLETED")).toBe("Execução de agente concluída");
    expect(actionLabel("JUDICIAL_PUBLICATION_NO_DEADLINE")).toBe("Publicação tratada sem prazo");
    expect(actionLabel("AGENT_RUN_SITUACAO_NOVA")).toBe("Execução de agente atualizada");
    expect(hasActionLabel("AGENT_RUN_SITUACAO_NOVA")).toBe(true);
    expect(hasActionLabel("ALGO_NOVO")).toBe(false);
  });
});

describe("campos alterados na auditoria", () => {
  it("mostra o nome do campo como na tela, nunca o nome da coluna", () => {
    expect(changedFieldsText(["title", "summary", "updated_at"])).toBe("campos: título, resumo");
    expect(changedFieldsText(["assigned_lawyer_id"])).toBe("campo: advogado responsável");
    expect(eventDetail({ metadata: { fields: ["cnj_number", "court"] }, metadataOmitted: false })).toBe("campos: número CNJ, tribunal");
  });

  it("coluna sem rótulo entra só na contagem", () => {
    expect(changedFieldsText(["title", "coluna_tecnica_x", "outra_y"])).toBe("campos: título e mais 2");
    expect(changedFieldsText(["coluna_tecnica_x"])).toBe("1 campo alterado");
    expect(changedFieldsText(["coluna_tecnica_x", "outra_y"])).toBe("2 campos alterados");
  });

  it("colunas de controle não aparecem; rótulo repetido sai uma vez", () => {
    expect(changedFieldsText(["updated_at", "status"])).toBeUndefined();
    expect(changedFieldsText(["address_city", "city"])).toBe("campo: cidade");
  });

  it("nenhum rótulo de campo é nome de coluna (sem sublinhado, em minúsculas ou sigla)", () => {
    for (const label of Object.values(AUDIT_FIELD_LABEL)) expect(label).not.toMatch(/_/);
  });
});
