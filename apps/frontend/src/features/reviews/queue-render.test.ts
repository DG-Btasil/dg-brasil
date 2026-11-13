import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OrgDirectory } from "@/lib/directory/types";
import { OrgDirectoryProvider } from "@/features/directory/directory-context";
import { bulkBlock, bulkBlockMessage } from "@/server/domain/reviews/bulk-rules";
import type { ReviewGroupDTO } from "@/server/domain/reviews/dto";
import { listItemFromRow, type ReviewRow } from "@/server/domain/reviews/mappers";
import { ReviewGroupList } from "./components/review-group-list";
import { ReviewTable, type ReviewSelection } from "./components/review-table";
import { DEFAULT_REVIEW_QUERY } from "./list-query";

/**
 * O HTML que a fila entrega (renderizado no servidor, sem navegador): colunas,
 * rótulos e o que pode ser marcado. A largura em pixels só se confere na tela.
 */

// As Server Actions não rodam aqui (só no servidor do Next): a tela é desenhada sem chamá-las.
vi.mock("@/server/domain/reviews/actions", () => ({ listReviewsAction: vi.fn(), decideReviewsBulkAction: vi.fn() }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LUCAS = id(900);
const directory = { owner: { id: id(1), name: "Escritório" }, users: [{ id: LUCAS, name: "Lucas Advogado" }], partners: [], complete: true } as unknown as OrgDirectory;
const html = (node: React.ReactNode) => renderToStaticMarkup(createElement(OrgDirectoryProvider, { directory } as Parameters<typeof OrgDirectoryProvider>[0], node));
const count = (text: string, part: string) => text.split(part).length - 1;

const row = (n: number, over: Partial<ReviewRow> = {}): ReviewRow => ({
  id: id(n),
  legal_case_id: id(500),
  legal_process_id: null,
  document_version_id: null,
  legal_analysis_id: null,
  agent_proposal_id: id(700 + n),
  agent_run_id: id(600),
  status: "PENDING",
  priority: "NORMAL",
  assigned_reviewer_id: LUCAS,
  due_at: null,
  created_at: "2026-11-13T10:00:00Z",
  updated_at: "2026-11-13T10:00:00Z",
  decided_at: null,
  agent_proposals: { proposal_type: "REQUEST_DOCUMENT", payload: { summary: "Pedir o extrato", data: { label: `Extrato do benefício ${n}` } }, agent_runs: { agents: { name: "Laura" } } },
  legal_cases: { title: "Caso Maria x Banco", clients: { individual_client_details: { full_name: "Maria Teste" } } },
  ...over,
});
const items = [
  listItemFromRow(row(1)),
  listItemFromRow(row(2, { agent_proposals: { proposal_type: "CREATE_DEADLINE", payload: { summary: "Prazo", data: { title: "Réplica" } } }, priority: "URGENT" })),
  listItemFromRow(row(3, { agent_proposal_id: null, agent_proposals: null, document_version_id: id(803), document_versions: { version_number: 2, documents: { title: "Minuta da inicial" } }, assigned_reviewer_id: null })),
  listItemFromRow(row(4, { status: "REJECTED", decided_at: "2026-11-13T12:00:00Z" })),
];

describe("tabela da fila — colunas e conteúdo", () => {
  it("lista: sete colunas, com 'Status' por último; o tipo, o caso, o cliente e o responsável aparecem", () => {
    const out = html(createElement(ReviewTable, { rows: items }));
    const headers = [...out.matchAll(/<th [^>]*>(.*?)<\/th>/g)].map((m) => m[1]);
    expect(headers).toEqual(["Revisão", "Tipo", "Caso / cliente", "Responsável", "Aguardando há", "Prioridade", "Status"]);
    expect(count(out, "<col")).toBe(headers.length + 1); // <colgroup> + uma <col> por coluna
    expect(out).toContain("table-fixed");
    expect(out).toContain("overflow-x-auto");
    expect(out).toContain("Pedido de documento");
    expect(out).toContain("Extrato do benefício 1");
    expect(out).toContain("Gerado por Laura");
    expect(out).toContain("Caso Maria x Banco");
    expect(out).toContain("Maria Teste");
    expect(out).toContain("Lucas Advogado");
    expect(out).toContain("Sem responsável");
    expect(out).toContain("Minuta da inicial (v2)");
    expect(out).toContain("Rejeitada");
    expect(out).toContain(`href="/revisoes/${id(1)}"`);
    expect(out).not.toContain('type="checkbox"');
  });
  it("dentro de um grupo: sem a coluna do caso; só proposta que a pessoa decide ganha caixa de marcar; o resto diz por quê", () => {
    const selection: ReviewSelection = {
      selected: new Set([id(1)]),
      blocked: (review) => {
        const reason = bulkBlock(review, "REJECTED", false);
        return reason ? bulkBlockMessage(reason, review) : undefined;
      },
      onToggle: () => undefined,
      onToggleAll: () => undefined,
    };
    const out = html(createElement(ReviewTable, { rows: items, showCase: false, selection }));
    const headers = [...out.matchAll(/<th [^>]*>(.*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    expect(headers.slice(1)).toEqual(["Revisão", "Tipo", "Responsável", "Aguardando há", "Prioridade", "Status"]);
    expect(out).not.toContain("Caso Maria x Banco");
    // Duas propostas em aberto (pedido de documento e prazo) + a caixa "marcar todos". Documento e item decidido: sem caixa.
    expect(count(out, 'type="checkbox"')).toBe(3);
    expect(count(out, "checked")).toBe(1);
    expect(out).toContain("Marcar Pedido de documento: Extrato do benefício 1");
    expect(out).toContain("Marcar Proposta de prazo: Réplica");
    expect(out).toContain("Documento: abra para ler e decidir.");
    expect(out).not.toContain("Já foi decidida.");
  });
});

describe("fila agrupada — cabeçalho do grupo", () => {
  const group = (over: Partial<ReviewGroupDTO> = {}): ReviewGroupDTO => ({
    key: `run:${id(600)}`,
    agentRunId: id(600),
    legalCaseId: id(500),
    agentName: "Laura",
    caseTitle: "Caso Maria x Banco",
    clientName: "Maria Teste",
    total: 21,
    documents: 1,
    proposals: 20,
    analyses: 0,
    open: 21,
    unassigned: 0,
    topPriority: "URGENT",
    firstCreatedAt: "2026-11-13T10:00:00Z",
    lastCreatedAt: "2026-11-13T10:05:00Z",
    reviewerIds: [LUCAS],
    ...over,
  });
  it("mostra o agente, o caso, o cliente, quantos itens por tipo, o responsável e a prioridade mais alta; começa fechado", () => {
    const out = html(createElement(ReviewGroupList, { groups: [group()], query: DEFAULT_REVIEW_QUERY, onChanged: () => undefined }));
    expect(out).toContain("Trabalho de Laura");
    expect(out).toContain("Caso Maria x Banco · Maria Teste");
    expect(out).toContain("21 itens");
    expect(out).toContain("1 documento · 20 propostas");
    expect(out).toContain("Lucas Advogado");
    expect(out).toContain("Urgente");
    expect(out).toContain("chegou ");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("<table");
  });
  it("o que a equipe enviou forma o grupo do caso; vários responsáveis e grupo já decidido têm rótulo próprio", () => {
    const people = group({ key: `case:${id(500)}`, agentRunId: undefined, agentName: undefined, total: 2, documents: 2, proposals: 0, open: 0, unassigned: 1, topPriority: "NORMAL" });
    const out = html(createElement(ReviewGroupList, { groups: [people, group({ reviewerIds: [] , unassigned: 21 })], query: DEFAULT_REVIEW_QUERY, onChanged: () => undefined }));
    expect(out).toContain("Enviado pela equipe");
    expect(out).toContain("2 documentos");
    expect(out).toContain("Vários responsáveis");
    expect(out).toContain("Tudo decidido");
    expect(out).toContain("Sem responsável");
    expect(count(out, "<li")).toBe(2);
  });
});
