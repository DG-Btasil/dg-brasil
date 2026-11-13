import { createElement, type FunctionComponent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ClientSession } from "@/lib/auth/types";
import type { OrgDirectory } from "@/lib/directory/types";
import type { Role } from "@/lib/permissions";
import type { Page } from "@/server/core/pagination";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";

/**
 * As telas de prazo renderizadas no servidor (sem navegador, sem banco): pega
 * erro de renderização e confere o que cada papel enxerga. As Server Actions e
 * o roteador do Next são trocados por dublês (aqui só importa o HTML).
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/prazos" }));
vi.mock("@/server/domain/processes/deadlines/actions", () => {
  const ok = async () => ({ ok: true, data: undefined, requestId: "r" });
  return {
    listDeadlinesAction: ok,
    createDeadlineAction: ok,
    updateDeadlineAction: ok,
    completeDeadlineAction: ok,
    cancelDeadlineAction: ok,
    markDeadlineMissedAction: ok,
    reopenDeadlineAction: ok,
    markDeadlineCheckedAction: ok,
  };
});
vi.mock("@/server/domain/processes/actions", () => ({ createProcessEventAction: async () => ({}), removeProcessAction: async () => ({}) }));

const { AuthProvider } = await import("@/features/auth/session-context");
const { OrgDirectoryProvider } = await import("@/features/directory/directory-context");
const { DeadlineAgenda } = await import("./components/deadline-agenda");
const { DeadlinesTab } = await import("@/features/processes/components/tabs/deadlines-tab");
const { DEFAULT_AGENDA_QUERY } = await import("./list-query");

const LAWYER = "00000000-0000-4000-8000-0000000000b1";
const CASE = "00000000-0000-4000-8000-0000000000c1";
const PROC = "00000000-0000-4000-8000-0000000000d1";

const directory: OrgDirectory = {
  owner: { id: "o1", name: "Barbara Cardoso Advocacia" },
  users: [{ id: LAWYER, name: "Lucas Fictício", displayName: "Lucas", role: "LAWYER", hasOab: true }],
  partners: [],
  complete: true,
};

function html(role: Role, node: ReactElement): string {
  const session = { userId: LAWYER, role, surface: "INTERNAL" } as unknown as ClientSession;
  // Os filhos vão como argumento do createElement (regra do lint); o tipo dos provedores pede `children` nas props.
  const Auth = AuthProvider as FunctionComponent<{ session: ClientSession }>;
  const Directory = OrgDirectoryProvider as FunctionComponent<{ directory: OrgDirectory }>;
  return renderToStaticMarkup(createElement(Auth, { session }, createElement(Directory, { directory }, node)));
}

const deadline = (over: Partial<DeadlineDTO>): DeadlineDTO => ({
  id: "d1",
  legalCaseId: CASE,
  processId: PROC,
  title: "Réplica à contestação",
  type: "REPLY",
  dueAt: "2099-03-11T02:59:59Z",
  dueDateLocal: "2099-03-10",
  dueTimeLocal: "23:59",
  priority: "NORMAL",
  status: "OPEN",
  effectiveStatus: "OPEN",
  responsibleUserId: LAWYER,
  source: "MANUAL",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  agentUnchecked: false,
  caseTitle: "Revisional Maria",
  clientName: "Maria Fictícia",
  processTitle: "Maria x Banco Fictício",
  processCnj: "00012345620268190001",
  ...over,
});

const items: DeadlineDTO[] = [
  deadline({ id: "vencido", title: "Contrarrazões vencidas", effectiveStatus: "OVERDUE", dueAt: "2020-01-11T02:59:59Z", dueDateLocal: "2020-01-10", responsibleUserId: undefined }),
  deadline({ id: "agente", title: "Prazo do agente", source: "AGENT", agentUnchecked: true }),
  deadline({ id: "audiencia", title: "Audiência de instrução", type: "HEARING", dueAt: "2099-03-10T17:30:00Z", dueTimeLocal: "14:30", hearingMode: "VIDEO", hearingLocation: "Sala 2 do Fórum", hearingLink: "https://exemplo.jus.br/sala" }),
  deadline({ id: "caso", title: "Prazo só do caso", processId: undefined, processCnj: undefined, processTitle: undefined, dueAt: "2099-03-12T02:59:59Z", dueDateLocal: "2099-03-11" }),
];
const page = (list: DeadlineDTO[]): { ok: true; data: Page<DeadlineDTO>; requestId: string } => ({
  ok: true,
  data: { items: list, page: 1, pageSize: 25, total: list.length, hasMore: false },
  requestId: "r",
});

describe("agenda de prazos — tela", () => {
  const agenda = (role: Role, list = items) =>
    html(role, createElement(DeadlineAgenda, { initialQuery: DEFAULT_AGENDA_QUERY, initialResult: page(list), summary: { overdue: 1, today: 0, next5Days: 2, agentUnchecked: 1 } }));

  it("advogado: vencidos no topo, grupos por dia, cliente, CNJ com máscara, responsável, selo do agente, audiência e ações", () => {
    const out = agenda("LAWYER");
    expect(out).toContain("<h1");
    expect(out).toContain("Prazos");
    // O grupo dos vencidos vem antes de qualquer dia.
    expect(out.indexOf("Vencidos, ainda em aberto")).toBeGreaterThan(0);
    expect(out.indexOf("Vencidos, ainda em aberto")).toBeLessThan(out.indexOf("10/03/2099"));
    expect(out.indexOf("10/03/2099")).toBeLessThan(out.indexOf("11/03/2099"));
    expect(out).toContain("Maria Fictícia");
    expect(out).toContain("0001234-56.2026.8.19.0001");
    expect(out).toContain("Lucas Fictício");
    expect(out).toContain("Sem responsável");
    expect(out).toContain("Agente, sem conferência");
    expect(out).toContain("Conferido");
    expect(out).toContain("10/03/2099 às 14:30");
    expect(out).toContain("Videoconferência");
    expect(out).toContain("Sala 2 do Fórum");
    expect(out).toContain('href="https://exemplo.jus.br/sala"');
    expect(out).toContain("Prazo do caso, sem processo");
    // Ações de quem pode editar, em toda linha em aberto (inclusive a do prazo só do caso).
    expect(out.match(/>Cumprir</g) ?? []).toHaveLength(4);
    expect(out).toContain(`href="/processos/${PROC}?aba=prazos"`);
    expect(out).toContain(`href="/casos/${CASE}"`);
    // Contadores do escritório e filtros.
    for (const text of ["Vencidos, em aberto", "Vencem hoje", "Vencem em até 5 dias", "Do agente, sem conferência", "Do agente, não conferidos", "Em aberto (com os vencidos)", "Os meus prazos"]) expect(out).toContain(text);
  });

  it("assistente só lê: vê os prazos e abre o processo, mas não cumpre nem confere", () => {
    const out = agenda("ASSISTANT");
    expect(out).toContain("Contrarrazões vencidas");
    expect(out).toContain("Agente, sem conferência");
    expect(out).not.toContain(">Cumprir<");
    expect(out).not.toContain(">Conferido<");
    expect(out).toContain(`href="/processos/${PROC}?aba=prazos"`);
  });

  it("encerrados: reabrir no lugar de cumprir, com o motivo registrado; vazio tem mensagem própria", () => {
    const closed = [
      deadline({ id: "c1", title: "Cancelado", status: "CANCELLED", effectiveStatus: "CANCELLED", statusReason: "Acordo homologado", statusChangedAt: "2026-11-10T15:00:00Z" }),
      deadline({ id: "c2", title: "Do agente, já conferido", status: "COMPLETED", effectiveStatus: "COMPLETED", source: "AGENT", agentUnchecked: false, checkedAt: "2026-11-09T15:00:00Z", checkedByUserId: LAWYER, completedAt: "2026-11-10T15:00:00Z" }),
    ];
    const out = agenda("LAWYER", closed);
    expect(out.match(/>Reabrir</g) ?? []).toHaveLength(2);
    expect(out).not.toContain(">Cumprir<");
    expect(out).toContain("Motivo: Acordo homologado");
    expect(out).toContain("Agente, conferido");
    expect(out).not.toContain("Vencidos, ainda em aberto");
    expect(agenda("LAWYER", [])).toContain("Nenhum prazo em aberto.");
  });

  it("falha ao carregar vira erro recuperável, não tela quebrada", () => {
    const failed = { ok: false as const, error: { code: "INTERNAL" as const, message: "Não foi possível concluir a operação." }, requestId: "r" };
    const out = html("LAWYER", createElement(DeadlineAgenda, { initialQuery: DEFAULT_AGENDA_QUERY, initialResult: failed }));
    expect(out).toContain("Não foi possível carregar os prazos.");
  });
});

describe("aba Prazos do processo — tela", () => {
  const tab = (role: Role, list: DeadlineDTO[]) => html(role, createElement(DeadlinesTab, { deadlines: page(list), onAdd: () => {}, onEdit: () => {} }));

  it("em aberto: cumprir pede confirmação (não há mais ação de um clique), menu com cancelar e prazo perdido, selo do agente e audiência", () => {
    const out = tab("LAWYER", items);
    expect(out.match(/>Cumprir</g) ?? []).toHaveLength(4);
    expect(out.match(/aria-haspopup="menu"/g) ?? []).toHaveLength(4);
    expect(out).toContain("Agente, sem conferência");
    expect(out).toContain("Videoconferência");
    expect(out).toContain("Adicionar prazo");
    expect(out).toContain('href="/prazos"');
  });

  it("encerrados: lista recolhida com reabrir e motivo; assistente não vê ações", () => {
    const closed = [...items, deadline({ id: "c1", title: "Cancelado", status: "CANCELLED", effectiveStatus: "CANCELLED", statusReason: "Acordo homologado" })];
    const out = tab("LAWYER", closed);
    expect(out).toContain("Encerrados");
    expect(out.match(/>Reabrir</g) ?? []).toHaveLength(1);
    expect(out).toContain("Motivo: Acordo homologado");
    const readOnly = tab("ASSISTANT", closed);
    expect(readOnly).not.toContain(">Reabrir<");
    expect(readOnly).not.toContain(">Cumprir<");
    expect(readOnly).not.toContain("Adicionar prazo");
  });
});
