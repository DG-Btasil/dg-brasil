import { describe, expect, it } from "vitest";
import { listReviewsSchema } from "@/server/domain/reviews/schemas";
import { listItemFromRow, type ReviewRow } from "@/server/domain/reviews/mappers";
import { templateSetupFromRow } from "@/server/domain/analyses/mappers";
import type { TemplateSetupRow } from "@/server/domain/analyses/repository";
import { startAnalysisSchema, sendAnalysisToAgentSchema } from "@/server/domain/analyses/schemas";
import type { TemplateFieldDTO } from "@/server/domain/analyses/dto";
import { fieldsPayload, formatFieldValue, validateFields } from "@/features/analyses/fields";
import { DEFAULT_REVIEW_QUERY, reviewQueryFromSearchParams, reviewQueryToInput, reviewQueryToSearchParams, type ReviewListQuery } from "./list-query";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

/* ------------------------------------------------------------------ */
/* Fila de revisões                                                    */
/* ------------------------------------------------------------------ */

describe("fila de revisões — URL e entrada da action", () => {
  it("ida e volta pela URL", () => {
    const q: ReviewListQuery = { view: "todas", priority: "URGENT", kind: "ANALYSIS", status: "APPROVED", unassigned: true, page: 2 };
    expect(reviewQueryFromSearchParams(Object.fromEntries(reviewQueryToSearchParams(q)))).toEqual(q);
  });
  it("padrão não polui a URL; valores inválidos voltam ao padrão", () => {
    expect(reviewQueryToSearchParams(DEFAULT_REVIEW_QUERY).toString()).toBe("");
    expect(reviewQueryFromSearchParams({ visao: "x", prioridade: "MAX", tipo: "?", pagina: "0" })).toEqual(DEFAULT_REVIEW_QUERY);
  });
  it("situação só vale em 'Todas'; 'Minhas' ignora 'sem responsável'", () => {
    expect(reviewQueryFromSearchParams({ situacao: "APPROVED" }).status).toBe("");
    expect(reviewQueryFromSearchParams({ visao: "minhas", sem_responsavel: "1" }).unassigned).toBe(false);
  });
  it("entrada passa no schema real: abertas = OPEN, mais antigas primeiro; minhas = assignee me", () => {
    const open = listReviewsSchema.parse(reviewQueryToInput(DEFAULT_REVIEW_QUERY));
    expect(open).toMatchObject({ status: "OPEN", column: "created_at", ascending: true });
    expect(listReviewsSchema.parse(reviewQueryToInput({ ...DEFAULT_REVIEW_QUERY, view: "minhas" }))).toMatchObject({ assignee: "me" });
    expect(listReviewsSchema.parse(reviewQueryToInput({ ...DEFAULT_REVIEW_QUERY, unassigned: true }))).toMatchObject({ assignee: "unassigned" });
    expect(listReviewsSchema.parse(reviewQueryToInput({ ...DEFAULT_REVIEW_QUERY, view: "todas", status: "REJECTED" }))).toMatchObject({ status: "REJECTED", ascending: false });
  });
});

describe("linha da fila — rótulos de leitura, nunca conteúdo", () => {
  const base: ReviewRow = {
    id: UUID,
    legal_case_id: UUID,
    legal_process_id: null,
    document_version_id: null,
    legal_analysis_id: UUID,
    agent_proposal_id: null,
    status: "PENDING",
    priority: "URGENT",
    assigned_reviewer_id: null,
    due_at: null,
    created_at: "2026-10-12T10:00:00Z",
    updated_at: "2026-10-12T10:00:00Z",
    decided_at: null,
  };
  it("análise: nome do template; caso e cliente do embed; PENDING + URGENT = URGENT", () => {
    const item = listItemFromRow({
      ...base,
      legal_analyses: { analysis_templates: { name: "Análise Bancária" } },
      legal_cases: [{ title: "Caso X", clients: { individual_client_details: [{ full_name: "Maria Teste" }], company_client_details: null } }],
    });
    expect(item).toMatchObject({ subject: "Análise: Análise Bancária", caseTitle: "Caso X", clientName: "Maria Teste", status: "URGENT", targetKind: "ANALYSIS" });
  });
  it("documento: título e versão; proposta: tipo e agente; embed nulo (RLS) não quebra", () => {
    const doc = listItemFromRow({ ...base, legal_analysis_id: null, document_version_id: UUID, document_versions: { version_number: 3, documents: { title: "Petição" } } });
    expect(doc.subject).toBe("Petição (v3)");
    const prop = listItemFromRow({ ...base, legal_analysis_id: null, agent_proposal_id: UUID, agent_proposals: { proposal_type: "UPDATE_AGENT", agent_runs: { agents: { name: "Agente X" } } } });
    expect(prop).toMatchObject({ subject: "Alteração de agente", agentName: "Agente X", requiresAdmin: true });
    expect(listItemFromRow({ ...base, legal_cases: null }).caseTitle).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Análise                                                             */
/* ------------------------------------------------------------------ */

const fields: TemplateFieldDTO[] = [
  { key: "banco", label: "Banco", type: "text", required: true },
  { key: "valor", label: "Valor", type: "currency", required: false },
  { key: "tipo", label: "Tipo", type: "select", required: false, options: [{ value: "consignado", label: "Consignado" }] },
  { key: "ativo", label: "Ativo", type: "boolean", required: false },
];

describe("assistente de análise — campos do template", () => {
  it("obrigatório, moeda, opção e sim/não", () => {
    expect(validateFields(fields, {})).toEqual({ banco: "Campo obrigatório." });
    expect(Object.keys(validateFields(fields, { banco: "X", valor: "abc", tipo: "outro", ativo: "talvez" })).sort()).toEqual(["ativo", "tipo", "valor"]);
    expect(validateFields(fields, { banco: "X", valor: "R$ 1.234,56", tipo: "consignado", ativo: "true" })).toEqual({});
  });
  it("payload: só campos do template, aparados, moeda como número; vazio não vai; passa no schema real", () => {
    const payload = fieldsPayload(fields, { banco: "  Banco X ", valor: "1.234,56", tipo: "", estranho: "x" });
    expect(payload).toEqual({ banco: "Banco X", valor: "1234.56" });
    expect(startAnalysisSchema.safeParse({ idempotencyKey: UUID, legalCaseId: UUID, templateId: UUID, fields: payload }).success).toBe(true);
    expect(formatFieldValue(fields[1], "1234.56")).toContain("1.234,56");
    expect(formatFieldValue(fields[2], "consignado")).toBe("Consignado");
  });
  it("envio exige chave de intenção (029)", () => {
    expect(sendAnalysisToAgentSchema.safeParse({ analysisId: UUID }).success).toBe(false);
    expect(sendAnalysisToAgentSchema.safeParse({ analysisId: UUID, idempotencyKey: UUID }).success).toBe(true);
  });
  it("modelo → assistente: campos ordenados, checklist do tipo de cliente, cumprido marcado, sem agente sinalizado", () => {
    const row: TemplateSetupRow = {
      id: UUID,
      name: "Análise Bancária",
      description: null,
      primary_agent_id: null,
      analysis_template_fields: [
        { key: "b", label: "B", field_type: "text", required: false, options: null, help_text: null, sort_order: 20 },
        { key: "a", label: "A", field_type: "text", required: true, options: null, help_text: "ajuda", sort_order: 10 },
      ],
      analysis_template_requirements: [
        { document_category: "CORPORATE_DOCUMENTS", label: "Contrato social", description: null, required: true, applies_to_client_kind: "COMPANY", sort_order: 5 },
        { document_category: "IDENTIFICATION", label: "RG/CPF", description: null, required: true, applies_to_client_kind: null, sort_order: 10 },
      ],
    };
    const setup = templateSetupFromRow(row, "INDIVIDUAL", new Set(["IDENTIFICATION"]));
    expect(setup.hasAgent).toBe(false);
    expect(setup.fields.map((f) => f.key)).toEqual(["a", "b"]);
    expect(setup.requirements).toEqual([{ category: "IDENTIFICATION", label: "RG/CPF", description: undefined, required: true, satisfied: true }]);
  });
});
