import { describe, expect, it } from "vitest";
import { runErrorLabel } from "@/lib/constants/ai";
import { parseMarkdownWithFrontmatter, nameFromSlug } from "@/features/dg-brasil/import-md";
import { resultFromRow } from "@/server/domain/analyses/mappers";
import { detailFromJson } from "@/server/domain/agents/mappers";
import { agentStatusFromDb, agentStatusToDb, configFromDb, configToDb, lineDiff, slugify } from "./mappers";
import { agentConfigSchema, saveSkillSchema } from "./schemas";
import { referenceObjectName, skillObjectName } from "./paths";

describe("configuração do agente (039: mesmo contrato do banco e do worker)", () => {
  it("lê a configuração gravada com os padrões do worker para o que falta", () => {
    const c = configFromDb({ model: "claude-sonnet-5-5", max_turns: 20 });
    expect(c).toEqual({ model: "claude-sonnet-5-5", effort: "high", codeExecution: true, maxTurns: 20, maxToolCalls: 120, maxDurationSeconds: 900, maxBudgetUsd: 2, tools: [] });
  });
  it("modelo fora da lista volta para o padrão; ida e volta preserva as chaves do contrato", () => {
    expect(configFromDb({ model: "gpt-5" }).model).toBe("claude-opus-5-5");
    const db = configToDb(configFromDb({ model: "claude-haiku-5-5", code_execution: false, tools: ["ver_caso"] }));
    expect(Object.keys(db).sort()).toEqual(["code_execution", "effort", "max_budget_usd", "max_duration_seconds", "max_tool_calls", "max_turns", "model", "tools"]);
    expect(db).toMatchObject({ model: "claude-haiku-5-5", code_execution: false, tools: ["ver_caso"] });
  });
  it("o schema recusa campo desconhecido (nada de shell) e limite fora da faixa", () => {
    const base = configFromDb({});
    expect(agentConfigSchema.safeParse({ ...base, shell: true }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ ...base, maxTurns: 0 }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ ...base, tools: ["executar_sql"] }).success).toBe(false);
    expect(agentConfigSchema.safeParse(base).success).toBe(true);
  });
  it("situação: Pausado na tela = INACTIVE no banco", () => {
    expect(agentStatusToDb("PAUSED")).toBe("INACTIVE");
    expect(agentStatusFromDb("INACTIVE")).toBe("PAUSED");
    expect(agentStatusFromDb("ACTIVE")).toBe("ACTIVE");
  });
});

describe("identificador e caminhos", () => {
  it("slug sem acento, minúsculo e sem nome reservado do provedor", () => {
    expect(slugify("Análise Bancária")).toBe("analise-bancaria");
    expect(slugify("Claude Helper", "abc123")).toBe("x-helper-abc123");
    expect(slugify("!!!")).toBe("item");
  });
  it("arquivo de skill e de referência no caminho da versão (o banco confere)", () => {
    expect(skillObjectName("s", "v", "scripts/a.py")).toBe("skills/s/v/scripts/a.py");
    expect(referenceObjectName("r", "v", "Petição (1).pdf")).toBe("references/r/v/Peti_o_1_.pdf");
  });
  it("caminho de arquivo de skill: sem '..', sem oculto, sem SKILL.md", () => {
    const base = { key: crypto.randomUUID(), id: crypto.randomUUID(), create: false, name: "X", description: "Quando usar", status: "ACTIVE", instructions: "x" };
    const file = (path: string) => ({ path, storageObjectName: "skills/a/b/c", mimeType: "text/x-python", size: 1, sha256: "a".repeat(64) });
    expect(saveSkillSchema.safeParse({ ...base, files: [file("scripts/ok.py")] }).success).toBe(true);
    for (const bad of ["../x.py", ".env", "a/.git/x", "SKILL.md", "/abs.py"]) {
      expect(saveSkillSchema.safeParse({ ...base, files: [file(bad)] }).success, bad).toBe(false);
    }
  });
});

describe("diferença entre versões", () => {
  it("marca linhas adicionadas e removidas, com contexto curto", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc");
    expect(d).toEqual([{ type: "context", text: "a" }, { type: "removed", text: "b" }, { type: "added", text: "B" }, { type: "context", text: "c" }]);
  });
  it("criação: tudo adicionado; texto enorme vira aviso", () => {
    expect(lineDiff("", "x\ny").every((l) => l.type === "added")).toBe(true);
    expect(lineDiff("", Array.from({ length: 5000 }, (_, i) => String(i)).join("\n"))[0]!.text).toMatch(/grande demais/);
  });
});

describe("importar agente/skill do Claude Code", () => {
  it("lê nome, descrição e corpo; ignora tools e model (avisando)", () => {
    const md = parseMarkdownWithFrontmatter("---\nname: lucas-procuracao\ndescription: \"Kit do cliente\"\ntools: Read, Bash\nmodel: sonnet\n---\n\n**Você é Lucas**\n");
    expect(md).toEqual({ name: "lucas-procuracao", description: "Kit do cliente", body: "**Você é Lucas**", ignored: ["tools", "model"] });
    expect(nameFromSlug("lucas-procuracao")).toBe("Lucas procuracao");
  });
  it("sem cabeçalho, o arquivo inteiro é o corpo", () => {
    expect(parseMarkdownWithFrontmatter("Só texto").body).toBe("Só texto");
  });
});

describe("resultado estruturado da análise (039)", () => {
  const THESIS = "6b0e1a52-6c49-4a9a-9f6f-2b8f3c3e1a11";
  const REF = "7c1f2b63-7d5a-4bab-8a7a-3c9a4d4f2b22";
  it("lê o resultado estruturado de forma defensiva (só o formato esperado)", () => {
    const r = resultFromRow("Resumo", {
      schema_version: 1, result_id: REF, recommendation: "Ajuizar",
      findings: [{ title: "Migração", detail: "Sem anuência", relevance: "HIGH", document_version_ids: [REF, "x"] }, "lixo"],
      missing_information: ["Extrato", 3], recommendations: [], proposed_actions: [{ description: "Pedir extrato", proposal_type: "OTHER" }],
      references_used: [{ reference_id: REF, title: "Orientação", how_used: "Bloco D" }, { reference_id: "nao-uuid" }],
      theses_considered: [{ thesis_id: THESIS, title: "Tese da Quitação", applicable: true, rationale: "Quitada" }],
      identified_thesis_ids: [THESIS],
    });
    expect(r?.findings).toEqual([{ title: "Migração", detail: "Sem anuência", relevance: "HIGH", documentVersionIds: [REF] }]);
    expect(r?.missingInformation).toEqual(["Extrato"]);
    expect(r?.referencesUsed).toEqual([{ referenceId: REF, title: "Orientação", howUsed: "Bloco D" }]);
    expect(r?.thesesConsidered).toEqual([{ thesisId: THESIS, title: "Tese da Quitação", applicable: true, rationale: "Quitada" }]);
    expect(r?.identifiedThesisIds).toEqual([THESIS]);
  });
  it("resultado antigo (sem schema_version) continua lido como antes", () => {
    expect(resultFromRow("R", { recommendation: "X" })).toEqual({ summary: "R", identifiedThesisIds: [], recommendation: "X" });
  });
});

describe("execução: detalhe e erro amigável", () => {
  it("erro bruto nunca aparece: cada categoria tem texto de usuário", () => {
    expect(runErrorLabel("PROVIDER_RATE_LIMITED")).toMatch(/limitou o uso/);
    expect(runErrorLabel("ALGO_NOVO")).toBe("A execução falhou.");
    expect(runErrorLabel(null)).toBeUndefined();
  });
  it("detalhe: uso e configuração só quando o banco manda (ADMIN)", () => {
    const d = detailFromJson({
      id: "r1", agent: { id: "a", name: "Lucas", slug: "lucas" }, status: "WAITING_HUMAN", cancel_requested: false, attempt: 1,
      created_at: "2026-10-16T10:00:00Z", retried_by: [], proposals: [{ id: "p", type: "OTHER", status: "PENDING", summary: "x", review_id: "rv" }],
      documents: [], analysis_result: null, usage: null, config: null,
    });
    expect(d.usage).toBeUndefined();
    expect(d.config).toBeUndefined();
    expect(d.proposals[0]).toMatchObject({ reviewId: "rv", summary: "x" });
  });
});
