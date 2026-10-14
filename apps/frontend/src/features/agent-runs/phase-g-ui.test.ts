import { describe, expect, it } from "vitest";
import { listAgentRunsSchema } from "@/server/domain/agents/schemas";
import { summaryFromRow } from "@/server/domain/agents/mappers";
import { agentRunQueryFromSearchParams, agentRunQueryToInput, agentRunQueryToSearchParams, DEFAULT_AGENT_RUN_QUERY } from "./list-query";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

describe("execuções de agente — lista paginada (031)", () => {
  it("URL: situação e página; inválido volta ao padrão", () => {
    const q = { status: "FAILED" as const, page: 3 };
    expect(agentRunQueryFromSearchParams(Object.fromEntries(agentRunQueryToSearchParams(q)))).toEqual(q);
    expect(agentRunQueryFromSearchParams({ situacao: "X", pagina: "0" })).toEqual(DEFAULT_AGENT_RUN_QUERY);
  });
  it("entrada passa no schema real, com escopo de caso; situação fora do vocabulário é recusada", () => {
    expect(listAgentRunsSchema.parse(agentRunQueryToInput({ status: "QUEUED", page: 2 }, { legalCaseId: UUID }))).toMatchObject({ status: "QUEUED", legalCaseId: UUID, page: 2, pageSize: 25 });
    expect(listAgentRunsSchema.safeParse({ status: "DONE" }).success).toBe(false);
  });
  it("linha da RPC paginada vira o mesmo DTO da antiga (total fica fora do DTO)", () => {
    const dto = summaryFromRow({
      id: UUID,
      agent_id: UUID,
      agent_slug: "analise",
      agent_name: "Análise",
      legal_case_id: null,
      legal_process_id: null,
      status: "QUEUED",
      operation: "EXECUTE",
      requested_by: UUID,
      attempt: 1,
      error_code: null,
      created_at: "2026-10-13T10:00:00Z",
      started_at: null,
      completed_at: null,
      proposal_count: "2",
      total_count: "7",
    } as Parameters<typeof summaryFromRow>[0]);
    expect(dto).toMatchObject({ proposalCount: 2, legalCaseId: undefined });
    expect(dto).not.toHaveProperty("total_count");
  });
});
