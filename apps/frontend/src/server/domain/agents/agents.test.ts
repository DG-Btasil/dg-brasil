import { describe, expect, it } from "vitest";
import { DUPLICATE_WINDOW_MS, findRecentDuplicate, summaryFromRow, type AgentRunSummaryRow } from "./mappers";
import { listAgentRunSummariesSchema, requestAgentRunSchema } from "./schemas";

const AGENT = "00000000-0000-4000-8000-0000000000a1";
const CASE = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const NOW = Date.parse("2026-10-12T12:00:00Z");

const row = (over: Partial<AgentRunSummaryRow> = {}): AgentRunSummaryRow => ({
  id: "run1",
  agent_id: AGENT,
  agent_slug: "analise-bancaria",
  agent_name: "Análise Bancária",
  legal_case_id: CASE,
  legal_process_id: null,
  status: "QUEUED",
  operation: "EXECUTE",
  requested_by: USER,
  attempt: 0,
  error_code: null,
  created_at: new Date(NOW - 5_000).toISOString(),
  started_at: null,
  completed_at: null,
  proposal_count: "2",
  ...over,
});

const identity = { agentId: AGENT, legalCaseId: CASE, processId: null, operation: "EXECUTE", requestedBy: USER };

describe("resumo de execução", () => {
  it("mapeia as colunas fixas da RPC e converte o bigint", () => {
    expect(summaryFromRow(row())).toMatchObject({ id: "run1", agentId: AGENT, legalCaseId: CASE, status: "QUEUED", proposalCount: 2, requestedById: USER });
    expect(summaryFromRow(row({ legal_case_id: null })).legalCaseId).toBeUndefined();
  });
});

describe("duplo clique", () => {
  it("encontra o mesmo pedido ainda na fila dentro da janela", () => {
    expect(findRecentDuplicate([row()], identity, NOW)?.id).toBe("run1");
  });

  it("não deduplica pedido diferente, antigo, já iniciado ou de outra pessoa", () => {
    expect(findRecentDuplicate([row({ created_at: new Date(NOW - DUPLICATE_WINDOW_MS - 1).toISOString() })], identity, NOW)).toBeUndefined();
    expect(findRecentDuplicate([row({ status: "RUNNING" })], identity, NOW)).toBeUndefined();
    expect(findRecentDuplicate([row({ requested_by: "outro" })], identity, NOW)).toBeUndefined();
    expect(findRecentDuplicate([row({ operation: "REVIEW" })], identity, NOW)).toBeUndefined();
    expect(findRecentDuplicate([row({ legal_process_id: CASE })], identity, NOW)).toBeUndefined();
    expect(findRecentDuplicate([row({ legal_case_id: null })], identity, NOW)).toBeUndefined();
  });
});

describe("schemas", () => {
  it("pedido: operação no formato do banco, processo exige caso, texto com limite", () => {
    expect(requestAgentRunSchema.parse({ agentId: AGENT, legalCaseId: CASE })).toMatchObject({ operation: "EXECUTE" });
    expect(requestAgentRunSchema.safeParse({ agentId: AGENT, operation: "drop table" }).success).toBe(false);
    expect(requestAgentRunSchema.safeParse({ agentId: AGENT, processId: CASE }).success).toBe(false);
    expect(requestAgentRunSchema.safeParse({ agentId: AGENT, legalCaseId: CASE, requestText: "x".repeat(20_001) }).success).toBe(false);
    expect(requestAgentRunSchema.parse({ agentId: AGENT, legalCaseId: CASE, requestText: "   " }).requestText).toBeUndefined();
  });

  it("parâmetros livres do navegador são descartados", () => {
    const parsed = requestAgentRunSchema.parse({ agentId: AGENT, legalCaseId: CASE, parameters: { input: "segredo" }, requestedBy: USER });
    expect(parsed).not.toHaveProperty("parameters");
    expect(parsed).not.toHaveProperty("requestedBy");
  });

  it("resumos: limite entre 1 e 50", () => {
    expect(listAgentRunSummariesSchema.parse({}).limit).toBe(25);
    expect(listAgentRunSummariesSchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});
