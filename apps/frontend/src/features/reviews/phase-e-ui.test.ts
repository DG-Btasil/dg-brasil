import { describe, expect, it } from "vitest";
import { listReviewsSchema } from "@/server/domain/reviews/schemas";
import { listItemFromRow, type ReviewRow } from "@/server/domain/reviews/mappers";
import { templateSetupFromRow } from "@/server/domain/analyses/mappers";
import type { TemplateSetupRow } from "@/server/domain/analyses/repository";
import { startAnalysisSchema, sendAnalysisToAgentSchema } from "@/server/domain/analyses/schemas";
import type { TemplateFieldDTO } from "@/server/domain/analyses/dto";
import { fieldsPayload, formatFieldValue, validateFields } from "@/features/analyses/fields";
import {
  DEFAULT_REVIEW_QUERY,
  isReviewCounterActive,
  REVIEW_TOP_PRIORITY,
  reviewQueryFromSearchParams,
  reviewQueryToInput,
  reviewQueryToSearchParams,
  toggleReviewCounter,
  type ReviewListQuery,
} from "./list-query";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

/* ------------------------------------------------------------------ */
/* Fila de revisões                                                    */
/* ------------------------------------------------------------------ */

describe("fila de revisões — URL e entrada da action", () => {
  it("ida e volta pela URL", () => {
    const q: ReviewListQuery = { view: "todas", priority: "URGENT", kind: "ANALYSIS", status: "APPROVED", due: "NEXT_7_DAYS", unassigned: true, page: 2 };
    expect(reviewQueryFromSearchParams(Object.fromEntries(reviewQueryToSearchParams(q)))).toEqual(q);
    const top: ReviewListQuery = { ...DEFAULT_REVIEW_QUERY, priority: REVIEW_TOP_PRIORITY };
    expect(reviewQueryToSearchParams(top).toString()).toBe("prioridade=URGENT_HIGH");
    expect(reviewQueryFromSearchParams(Object.fromEntries(reviewQueryToSearchParams(top)))).toEqual(top);
  });
  it("prazo: ?prazo=7dias vira o filtro do servidor; valor desconhecido é ignorado", () => {
    const q = reviewQueryFromSearchParams({ prazo: "7dias" });
    expect(q.due).toBe("NEXT_7_DAYS");
    expect(listReviewsSchema.parse(reviewQueryToInput(q))).toMatchObject({ due: "NEXT_7_DAYS", status: "OPEN" });
    expect(reviewQueryFromSearchParams({ prazo: "30dias" }).due).toBe("");
  });
  it("urgentes e alta: o atalho manda as duas prioridades e passa no schema real", () => {
    const input = listReviewsSchema.parse(reviewQueryToInput({ ...DEFAULT_REVIEW_QUERY, priority: REVIEW_TOP_PRIORITY }));
    expect(input.priority).toEqual(["URGENT", "HIGH"]);
    expect(listReviewsSchema.parse(reviewQueryToInput({ ...DEFAULT_REVIEW_QUERY, priority: "LOW" })).priority).toBe("LOW");
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

describe("indicadores da fila — botões de filtro (E-05)", () => {
  it("aplicar e clicar de novo limpa só aquele filtro, voltando à página 1", () => {
    const start = { ...DEFAULT_REVIEW_QUERY, kind: "ANALYSIS" as const, page: 3 };
    for (const counter of ["topPriority", "dueSoon", "unassigned"] as const) {
      const on = toggleReviewCounter(start, counter);
      expect(isReviewCounterActive(on, counter)).toBe(true);
      expect(on).toMatchObject({ kind: "ANALYSIS", page: 1 });
      const off = toggleReviewCounter(on, counter);
      expect(isReviewCounterActive(off, counter)).toBe(false);
      expect(off).toEqual({ ...start, page: 1 });
    }
  });
  it("os indicadores contam revisões em aberto: aplicar a partir de 'Todas' volta para 'Aguardando decisão'", () => {
    const todas: ReviewListQuery = { ...DEFAULT_REVIEW_QUERY, view: "todas", status: "APPROVED" };
    expect(toggleReviewCounter(todas, "topPriority")).toMatchObject({ view: "abertas", status: "", priority: REVIEW_TOP_PRIORITY });
    expect(toggleReviewCounter(todas, "dueSoon")).toMatchObject({ view: "abertas", status: "", due: "NEXT_7_DAYS" });
    expect(toggleReviewCounter({ ...DEFAULT_REVIEW_QUERY, view: "minhas" }, "dueSoon")).toMatchObject({ view: "minhas", due: "NEXT_7_DAYS" });
  });
  it("'Sem responsável' sai de 'Atribuídas a mim'", () => {
    expect(toggleReviewCounter({ ...DEFAULT_REVIEW_QUERY, view: "minhas" }, "unassigned")).toMatchObject({ view: "abertas", unassigned: true });
  });
  it("'Aguardando decisão' mostra a fila em aberto inteira e nunca leva para 'Todas' (QA rodada 2)", () => {
    // marcado só quando a lista é exatamente a fila em aberto, sem filtro
    expect(isReviewCounterActive(DEFAULT_REVIEW_QUERY, "open")).toBe(true);
    expect(isReviewCounterActive({ ...DEFAULT_REVIEW_QUERY, due: "NEXT_7_DAYS" }, "open")).toBe(false);
    expect(isReviewCounterActive({ ...DEFAULT_REVIEW_QUERY, view: "todas" }, "open")).toBe(false);
    // clicar de novo não muda a lista
    expect(toggleReviewCounter(DEFAULT_REVIEW_QUERY, "open")).toEqual(DEFAULT_REVIEW_QUERY);
    // de qualquer filtro ou visão, volta para a fila em aberto sem filtros, página 1
    expect(toggleReviewCounter({ ...DEFAULT_REVIEW_QUERY, view: "todas", status: "REJECTED", page: 3 }, "open")).toEqual(DEFAULT_REVIEW_QUERY);
    expect(toggleReviewCounter({ ...DEFAULT_REVIEW_QUERY, priority: "URGENT_HIGH", due: "NEXT_7_DAYS", unassigned: true }, "open")).toEqual(DEFAULT_REVIEW_QUERY);
  });
  it("o filtro aplicado vai para a URL", () => {
    expect(reviewQueryToSearchParams(toggleReviewCounter(DEFAULT_REVIEW_QUERY, "dueSoon")).toString()).toBe("prazo=7dias");
    expect(reviewQueryToSearchParams(toggleReviewCounter(DEFAULT_REVIEW_QUERY, "unassigned")).toString()).toBe("sem_responsavel=1");
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
