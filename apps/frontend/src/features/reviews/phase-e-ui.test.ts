import { describe, expect, it } from "vitest";
import { listReviewGroupsSchema, listReviewsSchema } from "@/server/domain/reviews/schemas";
import { listItemFromRow, type ReviewRow } from "@/server/domain/reviews/mappers";
import { templateSetupFromRow } from "@/server/domain/analyses/mappers";
import type { TemplateSetupRow } from "@/server/domain/analyses/repository";
import { startAnalysisSchema, sendAnalysisToAgentSchema } from "@/server/domain/analyses/schemas";
import type { TemplateFieldDTO } from "@/server/domain/analyses/dto";
import { fieldsPayload, formatFieldValue, validateFields } from "@/features/analyses/fields";
import {
  clearReviewFilters,
  countReviewFilters,
  DEFAULT_REVIEW_QUERY,
  isReviewCounterActive,
  REVIEW_GROUP_ITEMS_PAGE_SIZE,
  REVIEW_TOP_PRIORITY,
  reviewGroupItemsInput,
  reviewQueryFitsUrl,
  reviewQueryFromSearchParams,
  reviewQueryToGroupInput,
  reviewQueryToInput,
  reviewQueryToSearchParams,
  toggleReviewCounter,
  type ReviewListQuery,
} from "./list-query";
import { groupCountsLabel, groupTitle, queueFromGroups, queueFromReviews } from "./queue-entries";

const UUID = "8f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8a";

/* ------------------------------------------------------------------ */
/* Fila de revisões                                                    */
/* ------------------------------------------------------------------ */

describe("fila de revisões — URL e entrada da action", () => {
  it("ida e volta pela URL", () => {
    const q: ReviewListQuery = { mode: "lista", view: "todas", search: "maria da silva", priority: "URGENT", kind: "ANALYSIS", status: "APPROVED", due: "NEXT_7_DAYS", unassigned: true, page: 2 };
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

describe("fila agrupada por execução, lista e busca (067)", () => {
  const UUID2 = "1f6c1f0e-3b7a-4d2c-9a51-2f4e5d6c7b8b";
  it("o padrão é agrupar por execução; a lista vai para a URL; modo desconhecido volta ao padrão", () => {
    expect(DEFAULT_REVIEW_QUERY.mode).toBe("grupos");
    expect(reviewQueryToSearchParams({ ...DEFAULT_REVIEW_QUERY, mode: "lista" }).toString()).toBe("modo=lista");
    expect(reviewQueryFromSearchParams({ modo: "lista" }).mode).toBe("lista");
    expect(reviewQueryFromSearchParams({ modo: "tabela" }).mode).toBe("grupos");
  });
  it("busca: vai para a URL só sem dígito (CPF e número de processo ficam fora); é aparada e limitada", () => {
    expect(reviewQueryToSearchParams({ ...DEFAULT_REVIEW_QUERY, search: "maria" }).toString()).toBe("busca=maria");
    const cpf = { ...DEFAULT_REVIEW_QUERY, search: "123.456.789-00" };
    expect(reviewQueryToSearchParams(cpf).toString()).toBe("");
    expect([reviewQueryFitsUrl(cpf), reviewQueryFitsUrl(DEFAULT_REVIEW_QUERY)]).toEqual([false, true]);
    expect(reviewQueryFromSearchParams({ busca: "  maria  " }).search).toBe("maria");
    expect(reviewQueryFromSearchParams({ busca: "0001234-56.2026" }).search).toBe("");
    expect(reviewQueryFromSearchParams({ busca: "a".repeat(300) }).search).toHaveLength(120);
  });
  it("a busca chega às duas listagens e conta como filtro; em branco não é filtro", () => {
    const q = { ...DEFAULT_REVIEW_QUERY, search: "  extrato  " };
    expect(listReviewsSchema.parse(reviewQueryToInput(q))).toMatchObject({ search: "extrato", status: "OPEN" });
    expect(listReviewGroupsSchema.parse(reviewQueryToGroupInput(q))).toMatchObject({ search: "extrato", status: "OPEN" });
    expect(countReviewFilters(q)).toBe(1);
    expect(countReviewFilters({ ...DEFAULT_REVIEW_QUERY, search: "   " })).toBe(0);
    expect(isReviewCounterActive(q, "open")).toBe(false);
  });
  it("grupos: mesmos filtros da lista, passam no schema real; abertas = mais antigos primeiro, todas = mais recentes", () => {
    const q: ReviewListQuery = { ...DEFAULT_REVIEW_QUERY, priority: REVIEW_TOP_PRIORITY, kind: "AGENT_PROPOSAL", due: "NEXT_7_DAYS", unassigned: true, page: 3 };
    expect(listReviewGroupsSchema.parse(reviewQueryToGroupInput(q))).toMatchObject({
      status: "OPEN",
      priority: ["URGENT", "HIGH"],
      targetKind: "AGENT_PROPOSAL",
      due: "NEXT_7_DAYS",
      assignee: "unassigned",
      sortDirection: "asc",
      page: 3,
      pageSize: 25,
    });
    expect(listReviewGroupsSchema.parse(reviewQueryToGroupInput({ ...DEFAULT_REVIEW_QUERY, view: "todas", status: "REJECTED" }))).toMatchObject({ status: "REJECTED", sortDirection: "desc" });
    expect(listReviewGroupsSchema.parse(reviewQueryToGroupInput({ ...DEFAULT_REVIEW_QUERY, view: "minhas" }))).toMatchObject({ assignee: "me" });
  });
  it("itens de um grupo: execução ou caso, com os filtros da fila e a página própria do grupo", () => {
    const q = { ...DEFAULT_REVIEW_QUERY, kind: "AGENT_PROPOSAL" as const, page: 4 };
    const run = listReviewsSchema.parse(reviewGroupItemsInput(q, { agentRunId: UUID, legalCaseId: UUID2 }));
    expect(run).toMatchObject({ groupRunId: UUID, status: "OPEN", targetKind: "AGENT_PROPOSAL", page: 1, pageSize: REVIEW_GROUP_ITEMS_PAGE_SIZE, column: "created_at", ascending: true });
    expect(run.groupCaseId).toBeUndefined();
    const people = listReviewsSchema.parse(reviewGroupItemsInput(q, { legalCaseId: UUID2 }, 2));
    expect(people).toMatchObject({ groupCaseId: UUID2, page: 2 });
    expect(people.groupRunId).toBeUndefined();
  });
  it("limpar filtros e trocar de visão mantêm o modo escolhido", () => {
    const q: ReviewListQuery = { ...DEFAULT_REVIEW_QUERY, mode: "lista", view: "todas", search: "maria", status: "APPROVED", page: 5 };
    expect(clearReviewFilters(q)).toEqual({ ...DEFAULT_REVIEW_QUERY, mode: "lista", view: "todas" });
    expect(clearReviewFilters(q, "minhas")).toEqual({ ...DEFAULT_REVIEW_QUERY, mode: "lista", view: "minhas" });
    expect(toggleReviewCounter(q, "open")).toEqual({ ...DEFAULT_REVIEW_QUERY, mode: "lista" });
  });
  it("página da fila: cada linha diz se é grupo ou revisão; erro passa adiante", () => {
    const group = {
      key: `run:${UUID}`,
      agentRunId: UUID,
      total: 3,
      documents: 1,
      proposals: 2,
      analyses: 0,
      open: 3,
      unassigned: 0,
      topPriority: "HIGH" as const,
      firstCreatedAt: "2026-11-13T10:00:00Z",
      lastCreatedAt: "2026-11-13T10:05:00Z",
      reviewerIds: [],
    };
    const groups = queueFromGroups({ ok: true, requestId: "r", data: { items: [group], page: 1, pageSize: 25, total: 1, hasMore: false, totalItems: 3 } });
    expect(groups).toMatchObject({ ok: true, data: { total: 1, totalItems: 3, items: [{ type: "group", group: { key: `run:${UUID}` } }] } });
    const review = listItemFromRow({
      id: UUID,
      legal_case_id: UUID,
      legal_process_id: null,
      document_version_id: null,
      legal_analysis_id: UUID,
      agent_proposal_id: null,
      status: "PENDING",
      priority: "NORMAL",
      assigned_reviewer_id: null,
      due_at: null,
      created_at: "2026-10-12T10:00:00Z",
      updated_at: "2026-10-12T10:00:00Z",
      decided_at: null,
    });
    const reviews = queueFromReviews({ ok: true, requestId: "r", data: { items: [review], page: 1, pageSize: 25, total: 1, hasMore: false } });
    expect(reviews).toMatchObject({ ok: true, data: { items: [{ type: "review", review: { id: UUID } }] } });
    const failure = { ok: false as const, requestId: "r", error: { code: "FORBIDDEN" as const, message: "x" } };
    expect(queueFromGroups(failure)).toBe(failure);
    expect(queueFromReviews(failure)).toBe(failure);
  });
  it("cabeçalho do grupo: agente (ou a equipe) e contagem por tipo, só dos tipos presentes", () => {
    expect(groupTitle({ agentRunId: UUID, agentName: "Laura" })).toBe("Trabalho de Laura");
    expect(groupTitle({ agentRunId: UUID })).toBe("Trabalho de agente");
    expect(groupTitle({ agentName: undefined })).toBe("Enviado pela equipe");
    expect(groupCountsLabel({ documents: 2, proposals: 17, analyses: 1 })).toBe("2 documentos · 17 propostas · 1 análise");
    expect(groupCountsLabel({ documents: 1, proposals: 0, analyses: 0 })).toBe("1 documento");
    expect(groupCountsLabel({ documents: 0, proposals: 1, analyses: 0 })).toBe("1 proposta");
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
