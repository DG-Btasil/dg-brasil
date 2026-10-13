import { describe, expect, it } from "vitest";
import { summaryFromRow, type AgentRunSummaryRow } from "./mappers";
import { listAgentRunSummariesSchema, requestAgentRunSchema } from "./schemas";

const AGENT = "00000000-0000-4000-8000-0000000000a1";
const CASE = "00000000-0000-4000-8000-0000000000c1";
const USER = "00000000-0000-4000-8000-0000000000b1";

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
  created_at: "2026-10-12T11:59:55Z",
  started_at: null,
  completed_at: null,
  proposal_count: "2",
  ...over,
});

const KEY = "00000000-0000-4000-8000-0000000000d1";

describe("resumo de execução", () => {
  it("mapeia as colunas fixas da RPC e converte o bigint", () => {
    expect(summaryFromRow(row())).toMatchObject({ id: "run1", agentId: AGENT, legalCaseId: CASE, status: "QUEUED", proposalCount: 2, requestedById: USER });
    expect(summaryFromRow(row({ legal_case_id: null })).legalCaseId).toBeUndefined();
  });
});

describe("schemas", () => {
  it("pedido: operação no formato do banco, processo exige caso, texto com limite", () => {
    expect(requestAgentRunSchema.parse({ idempotencyKey: KEY, agentId: AGENT, legalCaseId: CASE })).toMatchObject({ operation: "EXECUTE" });
    expect(requestAgentRunSchema.safeParse({ idempotencyKey: KEY, agentId: AGENT, operation: "drop table" }).success).toBe(false);
    expect(requestAgentRunSchema.safeParse({ idempotencyKey: KEY, agentId: AGENT, processId: CASE }).success).toBe(false);
    expect(requestAgentRunSchema.safeParse({ idempotencyKey: KEY, agentId: AGENT, legalCaseId: CASE, requestText: "x".repeat(20_001) }).success).toBe(false);
    expect(requestAgentRunSchema.parse({ idempotencyKey: KEY, agentId: AGENT, legalCaseId: CASE, requestText: "   " }).requestText).toBeUndefined();
  });

  it("chave de idempotência (UUID) é obrigatória", () => {
    expect(requestAgentRunSchema.safeParse({ agentId: AGENT, legalCaseId: CASE }).success).toBe(false);
    expect(requestAgentRunSchema.safeParse({ idempotencyKey: "clique-1", agentId: AGENT, legalCaseId: CASE }).success).toBe(false);
  });

  it("parâmetros livres do navegador são descartados", () => {
    const parsed = requestAgentRunSchema.parse({ idempotencyKey: KEY, agentId: AGENT, legalCaseId: CASE, parameters: { input: "segredo" }, requestedBy: USER });
    expect(parsed).not.toHaveProperty("parameters");
    expect(parsed).not.toHaveProperty("requestedBy");
  });

  it("resumos: limite entre 1 e 50", () => {
    expect(listAgentRunSummariesSchema.parse({}).limit).toBe(25);
    expect(listAgentRunSummariesSchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});
