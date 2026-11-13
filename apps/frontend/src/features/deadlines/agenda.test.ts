import { describe, expect, it } from "vitest";
import { isNavActive, navColumns, navItemsFor } from "@/components/navigation/nav-config";
import { resolveRouteArea } from "@/components/navigation/route-areas";
import { deadlineFormFields, deadlineSchema } from "@/features/processes/schemas";
import { can } from "@/lib/permissions";
import type { DeadlineDTO } from "@/server/domain/processes/deadlines/dto";
import { createDeadlineSchema, listDeadlinesSchema, updateDeadlineSchema } from "@/server/domain/processes/deadlines/schemas";
import {
  agendaHref,
  agendaQueryFromSearchParams,
  agendaQueryToInput,
  agendaQueryToSearchParams,
  countAgendaFilters,
  DEFAULT_AGENDA_QUERY,
  groupAgenda,
  officeToday,
  type DeadlineAgendaQuery,
} from "./list-query";

const UUID_A = "00000000-0000-4000-8000-0000000000a1";
const UUID_B = "00000000-0000-4000-8000-0000000000b2";

describe("agenda de prazos — URL", () => {
  it("padrão: prazos em aberto (com os vencidos), sem parâmetro na URL", () => {
    expect(agendaQueryFromSearchParams({})).toEqual(DEFAULT_AGENDA_QUERY);
    expect(agendaQueryToSearchParams(DEFAULT_AGENDA_QUERY).toString()).toBe("");
    expect(agendaHref()).toBe("/prazos");
    expect(countAgendaFilters(DEFAULT_AGENDA_QUERY)).toBe(0);
  });

  it("ida e volta de todos os filtros", () => {
    const q: DeadlineAgendaQuery = { situation: "vencidos", responsible: UUID_A, type: "HEARING", period: "datas", from: "2026-11-01", until: "2026-11-30", agentUnchecked: true, caseId: UUID_B, page: 3 };
    const params = Object.fromEntries(agendaQueryToSearchParams(q));
    expect(params).toEqual({ situacao: "vencidos", responsavel: UUID_A, tipo: "HEARING", periodo: "datas", de: "2026-11-01", ate: "2026-11-30", agente: "nao-conferidos", caso: UUID_B, pagina: "3" });
    expect(agendaQueryFromSearchParams(params)).toEqual(q);
    expect(countAgendaFilters(q)).toBe(6);
  });

  it("\"os meus\" vai para a URL como \"eu\"; período pronto não leva datas", () => {
    const q = { ...DEFAULT_AGENDA_QUERY, responsible: "me", period: "5dias" as const, situation: "no-prazo" as const };
    expect(agendaQueryToSearchParams(q).toString()).toBe("situacao=no-prazo&responsavel=eu&periodo=5dias");
    expect(agendaQueryFromSearchParams({ responsavel: "eu", periodo: "5dias", situacao: "no-prazo" })).toEqual(q);
  });

  it("valor inválido na URL cai no padrão, sem quebrar a tela", () => {
    expect(agendaQueryFromSearchParams({ situacao: "apagados", responsavel: "fulano", tipo: "QUALQUER", periodo: "ano", de: "01/11/2026", ate: "2026-13-40", caso: "1", pagina: "-2", agente: "sim" })).toEqual(DEFAULT_AGENDA_QUERY);
    // Só as datas na URL (link antigo ou digitado): vale como "escolher datas".
    expect(agendaQueryFromSearchParams({ de: "2026-11-01" })).toMatchObject({ period: "datas", from: "2026-11-01", until: "" });
  });

  it("links prontos: vencidos, próximos 5 dias e prazos de um caso", () => {
    expect(agendaHref({ situation: "vencidos" })).toBe("/prazos?situacao=vencidos");
    expect(agendaHref({ situation: "no-prazo", period: "5dias" })).toBe("/prazos?situacao=no-prazo&periodo=5dias");
    expect(agendaHref({ caseId: UUID_A })).toBe(`/prazos?caso=${UUID_A}`);
  });
});

describe("agenda de prazos — entrada do servidor", () => {
  const input = (q: Partial<DeadlineAgendaQuery>, today = "2026-11-13") => agendaQueryToInput({ ...DEFAULT_AGENDA_QUERY, ...q }, today);

  it("situações: em aberto inclui vencidos (status gravado); vencido e no prazo usam a situação derivada", () => {
    expect(input({})).toMatchObject({ status: "OPEN", effectiveStatus: undefined, sortDirection: "asc", page: 1, pageSize: 25 });
    expect(input({ situation: "vencidos" })).toMatchObject({ status: undefined, effectiveStatus: "OVERDUE", sortDirection: "asc" });
    expect(input({ situation: "no-prazo" })).toMatchObject({ status: undefined, effectiveStatus: "OPEN" });
    expect(input({ situation: "cumpridos" })).toMatchObject({ status: "COMPLETED", sortDirection: "desc" });
    expect(input({ situation: "cancelados" })).toMatchObject({ status: "CANCELLED", sortDirection: "desc" });
    expect(input({ situation: "perdidos" })).toMatchObject({ status: "MISSED", sortDirection: "desc" });
    expect(input({ situation: "todos" })).toMatchObject({ status: undefined, effectiveStatus: undefined, sortDirection: "asc" });
  });

  it("período: conta a partir de hoje no fuso do escritório, atravessando o mês; datas escolhidas vão como vieram", () => {
    expect(input({ period: "hoje" })).toMatchObject({ fromDate: "2026-11-13", untilDate: "2026-11-13" });
    expect(input({ period: "5dias" })).toMatchObject({ fromDate: "2026-11-13", untilDate: "2026-11-18" });
    expect(input({ period: "30dias" }, "2026-12-15")).toMatchObject({ fromDate: "2026-12-15", untilDate: "2027-01-14" });
    expect(input({ period: "datas", from: "2026-11-01", until: "" })).toMatchObject({ fromDate: "2026-11-01", untilDate: undefined });
    expect(input({})).not.toHaveProperty("fromDate");
    expect(officeToday(new Date("2026-11-14T02:30:00Z"))).toBe("2026-11-13");
    expect(officeToday(new Date("2026-11-14T03:00:00Z"))).toBe("2026-11-14");
  });

  it("toda combinação passa no schema REAL do servidor", () => {
    for (const situation of ["abertos", "vencidos", "no-prazo", "cumpridos", "cancelados", "perdidos", "todos"] as const) {
      const parsed = listDeadlinesSchema.parse(input({ situation, responsible: "me", type: "REPLY", period: "7dias", agentUnchecked: true, caseId: UUID_A, page: 2 }));
      expect(parsed).toMatchObject({ responsibleUserId: "me", type: "REPLY", agentUnchecked: true, caseId: UUID_A, page: 2, fromDate: "2026-11-13", untilDate: "2026-11-20" });
    }
    expect(listDeadlinesSchema.parse(input({}))).toMatchObject({ status: "OPEN", sortDirection: "asc" });
    expect(listDeadlinesSchema.parse(input({})).agentUnchecked).toBeUndefined();
  });
});

const deadline = (over: Partial<DeadlineDTO>): DeadlineDTO => ({
  id: "d",
  legalCaseId: UUID_A,
  title: "Prazo",
  type: "INTERNAL",
  dueAt: "2026-11-14T02:59:59Z",
  dueDateLocal: "2026-11-13",
  dueTimeLocal: "23:59",
  priority: "NORMAL",
  status: "OPEN",
  effectiveStatus: "OPEN",
  source: "MANUAL",
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  agentUnchecked: false,
  ...over,
});

describe("agenda de prazos — grupos por dia", () => {
  it("vencidos formam um grupo só, no topo; os demais ficam por dia, na ordem do servidor", () => {
    const groups = groupAgenda([
      deadline({ id: "v1", effectiveStatus: "OVERDUE", dueDateLocal: "2026-11-02" }),
      deadline({ id: "v2", effectiveStatus: "OVERDUE", dueDateLocal: "2026-11-10" }),
      deadline({ id: "h1", dueDateLocal: "2026-11-13" }),
      deadline({ id: "h2", dueDateLocal: "2026-11-13" }),
      deadline({ id: "a1", dueDateLocal: "2026-11-16" }),
    ]);
    expect(groups.map((g) => [g.key, g.overdue, g.items.map((d) => d.id)])).toEqual([
      ["overdue", true, ["v1", "v2"]],
      ["2026-11-13", false, ["h1", "h2"]],
      ["2026-11-16", false, ["a1"]],
    ]);
  });

  it("sem vencidos não há grupo de vencidos; encerrados agrupam pela data do prazo; página vazia não tem grupo", () => {
    expect(groupAgenda([])).toEqual([]);
    const groups = groupAgenda([deadline({ id: "c1", status: "COMPLETED", effectiveStatus: "COMPLETED", dueDateLocal: "2026-11-01" }), deadline({ id: "c2", status: "CANCELLED", effectiveStatus: "CANCELLED", dueDateLocal: "2026-11-01" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "2026-11-01", overdue: false, date: "2026-11-01" });
  });
});

describe("menu — Prazos", () => {
  it("item da equipe interna, com a permissão de ver processos, logo depois de Processos; o parceiro não tem", () => {
    const owner = navItemsFor("OWNER");
    const item = owner.find((i) => i.key === "deadlines");
    expect(item).toMatchObject({ label: "Prazos", href: "/prazos", permission: "processes.view" });
    expect(owner.findIndex((i) => i.key === "deadlines")).toBe(owner.findIndex((i) => i.key === "processes") + 1);
    expect(navItemsFor("PARTNER").some((i) => i.href === "/prazos")).toBe(false);
    expect(new Set(owner.map((i) => i.href)).size).toBe(owner.length);
  });

  it("a área atual do cabeçalho reconhece /prazos (e não confunde com /processos)", () => {
    expect(resolveRouteArea("/prazos", "OWNER")).toMatchObject({ key: "deadlines", label: "Prazos" });
    expect(resolveRouteArea("/processos/123", "OWNER").key).toBe("processes");
    expect(isNavActive("/prazos", "/processos")).toBe(false);
  });

  it("grade do menu: três colunas como sempre; com o menu completo do Administrador (10 itens) são cinco, em duas linhas cheias", () => {
    const admin = navItemsFor("OWNER").filter((i) => can("ADMIN", i.permission));
    expect(admin).toHaveLength(10);
    expect(navColumns(admin.length)).toBe(5);
    for (const n of [1, 3, 5, 6, 8, 9, 11, 12]) expect(navColumns(n)).toBe(3);
    for (const role of ["LAWYER", "ASSISTANT"] as const) expect(navItemsFor("OWNER").some((i) => i.key === "deadlines" && can(role, i.permission))).toBe(true);
  });
});

describe("formulário de prazo → schema real", () => {
  const form = (over: Record<string, string> = {}) => ({ title: " Réplica ", type: "REPLY", dueDate: "2026-11-20", dueTime: "", responsibleUserId: UUID_B, hearingMode: "", hearingLocation: "", hearingLink: "", notes: "", ...over });

  it("prazo comum: sem hora e sem dados de audiência, mesmo que tenham ficado preenchidos", () => {
    const fields = deadlineFormFields(deadlineSchema.parse(form({ dueTime: "10:00", hearingMode: "VIDEO", hearingLink: "https://x.y" })));
    expect(fields).toMatchObject({ title: "Réplica", type: "REPLY", dueDate: "2026-11-20", dueTime: undefined, hearingMode: undefined, hearingLocation: undefined, hearingLink: undefined });
    const parsed = createDeadlineSchema.parse({ ...fields, legalCaseId: UUID_A, idempotencyKey: UUID_B });
    expect(parsed).toMatchObject({ type: "REPLY", dueDate: "2026-11-20" });
    expect(parsed.dueTime).toBeUndefined();
  });

  it("audiência: hora e modalidade obrigatórias; link precisa ser http(s); local e link vazios limpam", () => {
    const errors = (over: Record<string, string>) => {
      const r = deadlineSchema.safeParse(form({ type: "HEARING", ...over }));
      return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    };
    expect(errors({})).toEqual(["dueTime", "hearingMode"]);
    expect(errors({ dueTime: "14:30", hearingMode: "IN_PERSON", hearingLink: "sala 3" })).toEqual(["hearingLink"]);
    expect(errors({ dueTime: "14:30", hearingMode: "IN_PERSON" })).toEqual([]);
    const fields = deadlineFormFields(deadlineSchema.parse(form({ type: "HEARING", dueTime: "14:30", hearingMode: "VIDEO", hearingLocation: " Sala 2 ", hearingLink: "" })));
    expect(fields).toMatchObject({ dueTime: "14:30", hearingMode: "VIDEO", hearingLocation: "Sala 2", hearingLink: "" });
    const created = createDeadlineSchema.parse({ ...fields, legalCaseId: UUID_A, idempotencyKey: UUID_B });
    expect(created).toMatchObject({ type: "HEARING", dueTime: "14:30", hearingMode: "VIDEO", hearingLocation: "Sala 2", hearingLink: undefined });
    const edited = updateDeadlineSchema.parse({ id: UUID_A, patch: fields });
    expect(edited.patch).toMatchObject({ hearingMode: "VIDEO", hearingLocation: "Sala 2" });
    expect("hearingLink" in edited.patch).toBe(true);
  });
});
