import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { ServiceContext } from "@/server/core/context";
import { DomainError } from "@/server/core/errors";
import { buildCsv } from "@/server/domain/exports/csv";
import { listProfileNames } from "../repository";
import { DEADLINE_EXPORT_COLUMNS, type DeadlineExportRow } from "./export";
import {
  addDays,
  deadlineCreatePayload,
  deadlineFromAgendaRow,
  deadlineInsertRow,
  deadlineUpdatePatch,
  dueAtFromInput,
  officeLocalDate,
  officeLocalTime,
  resolveResponsible,
  type DeadlineAgendaRow,
} from "./mappers";
import { getOne, listAgendaPage } from "./repository";
import {
  cancelDeadlineSchema,
  createDeadlineSchema,
  listDeadlinesSchema,
  listOverdueSchema,
  listUpcomingSchema,
  missDeadlineSchema,
  reopenDeadlineSchema,
  updateDeadlineSchema,
} from "./schemas";
import * as service from "./service";

// Nomes da equipe (planilha): o repositório de processos não chega ao banco neste teste.
vi.mock("../repository", () => ({ listProfileNames: vi.fn(async (_db: unknown, ids: string[]) => ids.map((id) => ({ id, full_name: `Nome de ${id}` }))) }));

const CASE = "00000000-0000-4000-8000-0000000000c1";
const PROC = "00000000-0000-4000-8000-0000000000d1";
const USER = "00000000-0000-4000-8000-0000000000b1";
const KEY = "00000000-0000-4000-8000-0000000000e1";

const row = (over: Partial<DeadlineAgendaRow> = {}): DeadlineAgendaRow => ({
  id: "d1",
  legal_case_id: CASE,
  legal_process_id: PROC,
  title: "Réplica",
  deadline_type: "REPLY",
  description: null,
  due_at: "2026-10-11T02:59:59Z",
  due_date_local: "2026-10-10",
  priority: "HIGH",
  status: "OPEN",
  effective_status: "OPEN",
  responsible_user_id: USER,
  source: "MANUAL",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completed_at: null,
  status_reason: null,
  status_changed_at: null,
  status_changed_by: null,
  checked_at: null,
  checked_by: null,
  agent_unchecked: false,
  hearing_mode: null,
  hearing_location: null,
  hearing_link: null,
  case_title: "Revisional Maria",
  client_id: "00000000-0000-4000-8000-0000000000a1",
  client_name: "Maria Fictícia",
  process_title: "Maria x Banco",
  process_cnj: "00012345620268190001",
  process_court: "TJRJ",
  ...over,
});

describe("schemas de prazo", () => {
  it("caso obrigatório; processo opcional; exatamente uma forma de vencimento; chave de envio obrigatória", () => {
    expect(createDeadlineSchema.safeParse({ idempotencyKey: KEY, title: "x", dueDate: "2026-10-20" }).success).toBe(false);
    const ok = createDeadlineSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "x", dueDate: "2026-10-20" });
    expect(ok).toMatchObject({ type: "INTERNAL", priority: "NORMAL" });
    expect(ok.processId).toBeUndefined();
    expect(createDeadlineSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "x" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "x", dueDate: "2026-10-20", dueAt: "2026-10-20T10:00:00Z" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ idempotencyKey: KEY, legalCaseId: CASE, title: "x", dueDate: "20/10/2026" }).success).toBe(false);
    // Sem a chave de envio, o reenvio duplicaria o prazo: o servidor nem aceita.
    expect(createDeadlineSchema.safeParse({ legalCaseId: CASE, title: "x", dueDate: "2026-10-20" }).success).toBe(false);
  });

  it("hora só junto com a data civil; hora e link da audiência têm formato conferido", () => {
    const base = { idempotencyKey: KEY, legalCaseId: CASE, title: "Audiência", type: "HEARING" };
    expect(createDeadlineSchema.safeParse({ ...base, dueDate: "2026-11-05", dueTime: "14:30", hearingMode: "VIDEO", hearingLink: "https://exemplo.jus.br/sala" }).success).toBe(true);
    expect(createDeadlineSchema.safeParse({ ...base, dueAt: "2026-11-05T14:30:00-03:00", dueTime: "14:30" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ ...base, dueDate: "2026-11-05", dueTime: "25:00" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ ...base, dueDate: "2026-11-05", hearingMode: "TELEFONE" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ ...base, dueDate: "2026-11-05", hearingLink: "javascript:alert(1)" }).success).toBe(false);
    expect(createDeadlineSchema.parse({ ...base, dueDate: "2026-11-05", hearingLink: "  ", hearingLocation: " " })).toMatchObject({ hearingLink: undefined, hearingLocation: undefined });
  });

  it("status não é editável pelo PATCH (só cumprir, cancelar, perder e reabrir)", () => {
    const parsed = updateDeadlineSchema.parse({ id: CASE, patch: { title: "y", status: "COMPLETED" } });
    expect(parsed.patch).not.toHaveProperty("status");
    expect(updateDeadlineSchema.safeParse({ id: CASE, patch: {} }).success).toBe(false);
  });

  it("cancelar e reabrir exigem motivo; prazo perdido aceita sem", () => {
    expect(cancelDeadlineSchema.safeParse({ id: CASE }).success).toBe(false);
    expect(cancelDeadlineSchema.safeParse({ id: CASE, reason: "   " }).success).toBe(false);
    expect(cancelDeadlineSchema.parse({ id: CASE, reason: " Acordo homologado " }).reason).toBe("Acordo homologado");
    expect(reopenDeadlineSchema.safeParse({ id: CASE, reason: "" }).success).toBe(false);
    expect(reopenDeadlineSchema.safeParse({ id: CASE, reason: "x".repeat(1001) }).success).toBe(false);
    expect(missDeadlineSchema.parse({ id: CASE }).reason).toBeUndefined();
    expect(missDeadlineSchema.parse({ id: CASE, reason: "" }).reason).toBeUndefined();
  });

  it("filtro de responsável: UUID ou \"me\" (resolvido pela sessão)", () => {
    expect(listOverdueSchema.parse({ responsibleUserId: "me" }).responsibleUserId).toBe("me");
    expect(listDeadlinesSchema.parse({ responsibleUserId: USER }).responsibleUserId).toBe(USER);
    expect(listUpcomingSchema.safeParse({ responsibleUserId: "todos" }).success).toBe(false);
    expect(resolveResponsible("me", USER)).toBe(USER);
    expect(resolveResponsible(CASE, USER)).toBe(CASE);
    expect(resolveResponsible(undefined, USER)).toBeUndefined();
  });

  it("filtros da agenda: situação gravada, tipo, período, do agente não conferidos e ordem", () => {
    const parsed = listDeadlinesSchema.parse({ status: "OPEN", type: "HEARING", fromDate: "2026-11-01", untilDate: "2026-11-30", agentUnchecked: true, sortDirection: "desc" });
    expect(parsed).toMatchObject({ status: "OPEN", type: "HEARING", fromDate: "2026-11-01", untilDate: "2026-11-30", agentUnchecked: true, sortDirection: "desc", page: 1, pageSize: 25 });
    expect(listDeadlinesSchema.parse({}).sortDirection).toBe("asc");
    expect(listDeadlinesSchema.safeParse({ status: "OVERDUE" }).success).toBe(false);
    expect(listDeadlinesSchema.safeParse({ type: "QUALQUER" }).success).toBe(false);
    expect(listDeadlinesSchema.safeParse({ fromDate: "01/11/2026" }).success).toBe(false);
  });

  it("janela de próximos prazos limitada", () => {
    expect(listUpcomingSchema.parse({}).days).toBe(30);
    expect(listUpcomingSchema.safeParse({ days: 1000 }).success).toBe(false);
  });
});

describe("datas no fuso do escritório", () => {
  it("data civil vira fim do dia em Brasília; com hora (audiência), a hora informada", () => {
    expect(dueAtFromInput({ dueDate: "2026-10-20" })).toBe("2026-10-20T23:59:59-03:00");
    expect(dueAtFromInput({ dueDate: "2026-10-20", dueTime: "14:30" })).toBe("2026-10-20T14:30:00-03:00");
    expect(dueAtFromInput({ dueAt: "2026-10-20T10:00:00Z" })).toBe("2026-10-20T10:00:00Z");
    expect(dueAtFromInput({})).toBeUndefined();
  });

  it("data e hora locais de São Paulo (02:00Z ainda é o dia anterior) e soma de dias", () => {
    expect(officeLocalDate(new Date("2026-10-13T02:00:00Z"))).toBe("2026-10-12");
    expect(officeLocalDate(new Date("2026-10-13T03:00:00Z"))).toBe("2026-10-13");
    expect(officeLocalTime("2026-10-13T02:59:59Z")).toBe("23:59");
    expect(officeLocalTime("2026-10-13T17:30:00Z")).toBe("14:30");
    expect(officeLocalTime("2026-10-13T03:00:00Z")).toBe("00:00");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("mapeamento de prazo", () => {
  it("situação efetiva vem do banco (OVERDUE derivado), status gravado preservado, com cliente e processo", () => {
    const dto = deadlineFromAgendaRow(row({ effective_status: "OVERDUE" }));
    expect(dto).toMatchObject({
      status: "OPEN",
      effectiveStatus: "OVERDUE",
      dueDateLocal: "2026-10-10",
      dueTimeLocal: "23:59",
      processId: PROC,
      type: "REPLY",
      clientName: "Maria Fictícia",
      caseTitle: "Revisional Maria",
      processTitle: "Maria x Banco",
      processCnj: "00012345620268190001",
      agentUnchecked: false,
    });
    expect(dto.statusReason).toBeUndefined();
    expect(dto.hearingMode).toBeUndefined();
  });

  it("prazo só do caso, do agente e sem conferência; audiência com hora, modalidade e link", () => {
    const dto = deadlineFromAgendaRow(
      row({ legal_process_id: null, process_title: null, process_cnj: null, process_court: null, source: "AGENT", agent_unchecked: true, deadline_type: "HEARING", due_at: "2026-11-05T17:30:00Z", due_date_local: "2026-11-05", hearing_mode: "VIDEO", hearing_link: "https://exemplo.jus.br/sala" }),
    );
    expect(dto.processId).toBeUndefined();
    expect(dto.processCnj).toBeUndefined();
    expect(dto).toMatchObject({ source: "AGENT", agentUnchecked: true, dueTimeLocal: "14:30", hearingMode: "VIDEO", hearingLink: "https://exemplo.jus.br/sala" });
  });

  it("insert: origem MANUAL, status não enviado (default OPEN), responsável padrão", () => {
    const input = createDeadlineSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "Audiência", type: "HEARING", dueDate: "2026-11-05" });
    const out = deadlineInsertRow("d9", input, USER);
    expect(out).toEqual({
      id: "d9",
      legal_case_id: CASE,
      legal_process_id: null,
      title: "Audiência",
      deadline_type: "HEARING",
      description: null,
      due_at: "2026-11-05T23:59:59-03:00",
      priority: "NORMAL",
      responsible_user_id: USER,
      source: "MANUAL",
    });
    expect(out).not.toHaveProperty("status");
  });

  it("pedido com chave de envio: sem id, sem origem, sem a chave; o mesmo formulário gera o mesmo pedido", () => {
    const form = { idempotencyKey: KEY, legalCaseId: CASE, processId: PROC, title: "Audiência", type: "HEARING", dueDate: "2026-11-05", dueTime: "14:30", hearingMode: "IN_PERSON", hearingLocation: "Sala 2" };
    const a = deadlineCreatePayload(createDeadlineSchema.parse(form), USER);
    const b = deadlineCreatePayload(createDeadlineSchema.parse({ ...form }), USER);
    expect(a).toEqual(b);
    expect(a).toEqual({
      legal_case_id: CASE,
      legal_process_id: PROC,
      title: "Audiência",
      deadline_type: "HEARING",
      description: null,
      due_at: "2026-11-05T14:30:00-03:00",
      priority: "NORMAL",
      responsible_user_id: USER,
      hearing_mode: "IN_PERSON",
      hearing_location: "Sala 2",
      hearing_link: null,
    });
  });

  it("dados de audiência só ficam gravados quando o tipo é Audiência", () => {
    const reply = createDeadlineSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "Réplica", type: "REPLY", dueDate: "2026-11-05", hearingMode: "VIDEO", hearingLocation: "Sala 2" });
    expect(deadlineCreatePayload(reply, USER)).toMatchObject({ hearing_mode: null, hearing_location: null, hearing_link: null });
    expect(deadlineUpdatePatch({ type: "REPLY", hearingMode: "VIDEO" })).toEqual({ deadline_type: "REPLY", hearing_mode: null, hearing_location: null, hearing_link: null });
    expect(deadlineUpdatePatch({ type: "HEARING", hearingMode: "VIDEO", hearingLink: undefined })).toEqual({ deadline_type: "HEARING", hearing_mode: "VIDEO", hearing_link: null });
  });

  it("PATCH: só chaves presentes; a data só entra quando veio", () => {
    expect(deadlineUpdatePatch({ title: "Novo", dueDate: "2026-11-01", responsibleUserId: null })).toEqual({
      title: "Novo",
      due_at: "2026-11-01T23:59:59-03:00",
      responsible_user_id: null,
    });
    expect(deadlineUpdatePatch({ title: "Só o título" })).toEqual({ title: "Só o título" });
    expect(deadlineUpdatePatch({ dueDate: "2026-11-01", dueTime: "09:00" })).toEqual({ due_at: "2026-11-01T09:00:00-03:00" });
  });
});

/** Client mínimo do Supabase: registra tabela, filtros, ordem e RPCs; responde o que o teste mandar. */
function stubDb(answers: { rows?: unknown[]; one?: unknown; rpc?: Record<string, unknown>; rpcError?: { code: string; message: string } } = {}) {
  const calls: { table?: string; filters: [string, string, unknown][]; order: [string, boolean | undefined][]; range?: [number, number]; rpc: [string, unknown][] } = { filters: [], order: [], rpc: [] };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, value: unknown) => (calls.filters.push(["eq", col, value]), builder),
    gte: (col: string, value: unknown) => (calls.filters.push(["gte", col, value]), builder),
    lte: (col: string, value: unknown) => (calls.filters.push(["lte", col, value]), builder),
    is: (col: string, value: unknown) => (calls.filters.push(["is", col, value]), builder),
    order: (col: string, o?: { ascending?: boolean }) => (calls.order.push([col, o?.ascending]), builder),
    range: async (from: number, to: number) => ((calls.range = [from, to]), { data: answers.rows ?? [], error: null, count: (answers.rows ?? []).length }),
    maybeSingle: async () => ({ data: answers.one ?? null, error: null }),
  };
  const db = {
    from: (table: string) => ((calls.table = table), builder),
    rpc: async (fn: string, args: unknown) => (calls.rpc.push([fn, args]), answers.rpcError ? { data: null, error: answers.rpcError } : { data: answers.rpc?.[fn] ?? null, error: null }),
  };
  return { db: db as unknown as SupabaseClient, calls };
}

describe("repositório — agenda", () => {
  it("getOne lê a agenda e tira prazo de caso ou processo excluído (excluído → null → NOT_FOUND)", async () => {
    const { db, calls } = stubDb({ one: null });
    expect(await getOne(db, "d1")).toBeNull();
    expect(calls.table).toBe("deadline_agenda");
    expect(calls.filters).toContainEqual(["eq", "scope_deleted", false]);
    expect(calls.filters).toContainEqual(["eq", "id", "d1"]);
  });

  it("listagem: filtros no servidor, sem prazo de escopo excluído, por instante do vencimento com desempate", async () => {
    const { db, calls } = stubDb({ rows: [row()] });
    const r = await listAgendaPage(
      db,
      { status: "OPEN", effectiveStatus: "OVERDUE", responsibleUserId: USER, type: "HEARING", fromLocalDate: "2026-11-01", untilLocalDate: "2026-11-30", agentUnchecked: true, caseId: CASE },
      { page: 2, pageSize: 25 },
      false,
    );
    expect(r.total).toBe(1);
    expect(calls.table).toBe("deadline_agenda");
    expect(calls.filters).toEqual([
      ["eq", "scope_deleted", false],
      ["eq", "effective_status", "OVERDUE"],
      ["eq", "status", "OPEN"],
      ["eq", "legal_case_id", CASE],
      ["eq", "responsible_user_id", USER],
      ["eq", "deadline_type", "HEARING"],
      ["gte", "due_date_local", "2026-11-01"],
      ["lte", "due_date_local", "2026-11-30"],
      ["eq", "agent_unchecked", true],
    ]);
    expect(calls.order).toEqual([
      ["due_at", false],
      ["id", undefined],
    ]);
    expect(calls.range).toEqual([25, 49]);
  });

  it("sem o filtro \"do agente\", prazo conferido não é escondido", async () => {
    const { db, calls } = stubDb();
    await listAgendaPage(db, { agentUnchecked: false }, { page: 1, pageSize: 25 }, true);
    expect(calls.filters).toEqual([["eq", "scope_deleted", false]]);
  });
});

function ctxFor(role: "ADMIN" | "LAWYER" | "ASSISTANT" | "PARTNER_ADMIN", db: SupabaseClient): ServiceContext {
  const partner = role === "PARTNER_ADMIN";
  return {
    db,
    requestId: "req-test",
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    session: { userId: USER, role, surface: partner ? "PARTNER" : "INTERNAL", organizationId: "org", organizationType: partner ? "PARTNER" : "OWNER" },
  } as unknown as ServiceContext;
}
const rejected = async (p: Promise<unknown>) => p.then(() => undefined, (e: unknown) => (e instanceof DomainError ? e.code : `outro erro: ${String(e)}`));

describe("service — situação do prazo passa pelo banco", () => {
  it("cumprir, cancelar, perder e reabrir chamam deadline_transition com a ação e o motivo", async () => {
    const { db, calls } = stubDb();
    const ctx = ctxFor("LAWYER", db);
    await service.completeDeadline(ctx, "d1");
    await service.cancelDeadline(ctx, { id: "d1", reason: "Acordo" });
    await service.markDeadlineMissed(ctx, { id: "d1" });
    await service.reopenDeadline(ctx, { id: "d1", reason: "Engano" });
    expect(calls.rpc).toEqual([
      ["deadline_transition", { p_deadline_id: "d1", p_action: "COMPLETE", p_reason: null }],
      ["deadline_transition", { p_deadline_id: "d1", p_action: "CANCEL", p_reason: "Acordo" }],
      ["deadline_transition", { p_deadline_id: "d1", p_action: "MISS", p_reason: null }],
      ["deadline_transition", { p_deadline_id: "d1", p_action: "REOPEN", p_reason: "Engano" }],
    ]);
  });

  it("conferência do prazo do agente chama deadline_mark_checked", async () => {
    const { db, calls } = stubDb();
    await service.markDeadlineChecked(ctxFor("ADMIN", db), "d1");
    expect(calls.rpc).toEqual([["deadline_mark_checked", { p_deadline_id: "d1" }]]);
  });

  it("assistente e parceiro não mudam situação, não conferem e não criam: nem chegam ao banco", async () => {
    for (const role of ["ASSISTANT", "PARTNER_ADMIN"] as const) {
      const { db, calls } = stubDb();
      const ctx = ctxFor(role, db);
      expect(await rejected(service.completeDeadline(ctx, "d1"))).toBe("FORBIDDEN");
      expect(await rejected(service.reopenDeadline(ctx, { id: "d1", reason: "x" }))).toBe("FORBIDDEN");
      expect(await rejected(service.markDeadlineChecked(ctx, "d1"))).toBe("FORBIDDEN");
      expect(await rejected(service.createDeadline(ctx, createDeadlineSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "x", dueDate: "2026-10-20" })))).toBe("FORBIDDEN");
      expect(calls.rpc).toEqual([]);
    }
  });

  it("a recusa do banco chega com a mensagem dele: prazo encerrado (INVALID_STATE) e prazo que não existe (NOT_FOUND)", async () => {
    const closed = stubDb({ rpcError: { code: "23514", message: "Só é possível alterar um prazo em aberto. Reabra o prazo antes" } });
    const e = await service.completeDeadline(ctxFor("LAWYER", closed.db), "d1").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DomainError);
    expect([(e as DomainError).code, (e as DomainError).message]).toEqual(["INVALID_STATE", "Só é possível alterar um prazo em aberto. Reabra o prazo antes"]);
    const missing = stubDb({ rpcError: { code: "P0002", message: "Prazo não encontrado" } });
    expect(await rejected(service.reopenDeadline(ctxFor("LAWYER", missing.db), { id: "d1", reason: "x" }))).toBe("NOT_FOUND");
  });

  it("criar usa a chave de envio e devolve se o prazo já existia", async () => {
    const { db, calls } = stubDb({ one: { id: CASE }, rpc: { create_deadline_once: { deadline_id: "novo", deduplicated: true } } });
    const input = createDeadlineSchema.parse({ idempotencyKey: KEY, legalCaseId: CASE, title: "Réplica", type: "REPLY", dueDate: "2026-11-05" });
    expect(await service.createDeadline(ctxFor("LAWYER", db), input)).toEqual({ id: "novo", deduplicated: true });
    expect(calls.rpc).toHaveLength(1);
    const [fn, args] = calls.rpc[0] as [string, { p_key: string; p_deadline: Record<string, unknown> }];
    expect([fn, args.p_key]).toEqual(["create_deadline_once", KEY]);
    expect(args.p_deadline).toMatchObject({ legal_case_id: CASE, title: "Réplica", deadline_type: "REPLY", due_at: "2026-11-05T23:59:59-03:00", responsible_user_id: USER });
    expect(args.p_deadline).not.toHaveProperty("id");
    expect(args.p_deadline).not.toHaveProperty("source");
  });

  it("agenda: a ordem pedida e os filtros chegam ao repositório; \"me\" vira o usuário da sessão", async () => {
    const { db, calls } = stubDb({ rows: [row(), row({ id: "d2", legal_process_id: null })] });
    const page = await service.listDeadlines(ctxFor("ASSISTANT", db), listDeadlinesSchema.parse({ status: "COMPLETED", responsibleUserId: "me", sortDirection: "desc" }));
    expect(page.items.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(page.total).toBe(2);
    expect(calls.filters).toContainEqual(["eq", "responsible_user_id", USER]);
    expect(calls.filters).toContainEqual(["eq", "status", "COMPLETED"]);
    expect(calls.order[0]).toEqual(["due_at", false]);
    expect(await rejected(service.listDeadlines(ctxFor("PARTNER_ADMIN", stubDb().db), listDeadlinesSchema.parse({})))).toBe("FORBIDDEN");
  });
});

describe("planilha de prazos", () => {
  const CHECKER = "00000000-0000-4000-8000-0000000000b2";

  it("colunas: vencimento sem hora no prazo comum e com hora na audiência; vencido como na tela; CNJ com máscara; dados da audiência só na audiência", () => {
    const common: DeadlineExportRow = { ...deadlineFromAgendaRow(row({ effective_status: "OVERDUE", description: "Conferir documentos" })), responsibleName: "Lucas Fictício" };
    const hearing: DeadlineExportRow = {
      ...deadlineFromAgendaRow(
        row({
          id: "d2",
          title: "Audiência de instrução",
          deadline_type: "HEARING",
          due_at: "2026-11-20T17:30:00Z",
          due_date_local: "2026-11-20",
          source: "AGENT",
          checked_at: "2026-11-13T15:00:00Z",
          checked_by: CHECKER,
          hearing_mode: "VIDEO",
          hearing_location: "Sala 3; 2º andar",
          hearing_link: "https://tribunal.test/sala",
        }),
      ),
      responsibleName: "Lucas Fictício",
      checkedByName: "Barbara Fictícia",
    };
    // Dado de audiência que sobrou num prazo de outro tipo não sai; motivo só em prazo encerrado.
    const closed: DeadlineExportRow = deadlineFromAgendaRow(
      row({ id: "d3", legal_process_id: null, process_title: null, process_cnj: null, status: "CANCELLED", effective_status: "CANCELLED", status_reason: "Acordo", hearing_location: "Fórum", responsible_user_id: null }),
    );
    const lines = buildCsv(DEADLINE_EXPORT_COLUMNS, [common, hearing, closed]).split("\r\n");
    expect(lines[0]).toBe(
      "Vencimento;Hora;Prazo;Tipo;Situação;Cliente;Número CNJ;Processo;Caso;Responsável;Origem;Conferido por;Conferido em;Modalidade da audiência;Local da audiência;Link da audiência;Descrição;Cumprido em;Motivo da situação",
    );
    expect(lines[1]).toBe("10/10/2026;;Réplica;Réplica;Vencido;Maria Fictícia;0001234-56.2026.8.19.0001;Maria x Banco;Revisional Maria;Lucas Fictício;Pessoa;;;;;;Conferir documentos;;");
    expect(lines[2]).toBe(
      '20/11/2026;14:30;Audiência de instrução;Audiência;Em aberto;Maria Fictícia;0001234-56.2026.8.19.0001;Maria x Banco;Revisional Maria;Lucas Fictício;Agente;Barbara Fictícia;13/11/2026 12:00;Videoconferência;"Sala 3; 2º andar";https://tribunal.test/sala;;;',
    );
    expect(lines[3]).toBe("10/10/2026;;Réplica;Réplica;Cancelado;Maria Fictícia;;;Revisional Maria;;Pessoa;;;;;;;;Acordo");
  });

  it("ADMIN: os filtros e a ordem da agenda chegam ao repositório (sem a página da tela), com os nomes; a auditoria leva só os filtros", async () => {
    const { db, calls } = stubDb({ rows: [row({ source: "AGENT", checked_at: "2026-11-13T15:00:00Z", checked_by: CHECKER }), row({ id: "d2", responsible_user_id: null })] });
    const input = listDeadlinesSchema.parse({ status: "OPEN", type: "REPLY", responsibleUserId: "me", fromDate: "2026-10-01", untilDate: "2026-10-31", agentUnchecked: true, sortDirection: "desc", page: 4, pageSize: 25 });
    const file = await service.exportDeadlines(ctxFor("ADMIN", db), input);

    expect(calls.table).toBe("deadline_agenda");
    expect(calls.filters).toEqual([
      ["eq", "scope_deleted", false],
      ["eq", "status", "OPEN"],
      ["eq", "responsible_user_id", USER],
      ["eq", "deadline_type", "REPLY"],
      ["gte", "due_date_local", "2026-10-01"],
      ["lte", "due_date_local", "2026-10-31"],
      ["eq", "agent_unchecked", true],
    ]);
    expect(calls.order[0]).toEqual(["due_at", false]);
    // A planilha começa da primeira linha, em blocos de 500, qualquer que seja a página aberta na tela.
    expect(calls.range).toEqual([0, 499]);
    expect(vi.mocked(listProfileNames).mock.calls.at(-1)?.[1]).toEqual([USER, CHECKER]);
    const lines = file.content.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(";Nome de 00000000-0000-4000-8000-0000000000b1;Agente;Nome de 00000000-0000-4000-8000-0000000000b2;13/11/2026 12:00;");
    expect([file.rowCount, file.total, file.truncated, file.fileName.startsWith("prazos-")]).toEqual([2, 2, false, true]);
    expect(calls.rpc).toEqual([
      [
        "record_data_export",
        {
          p_kind: "deadlines",
          p_filters: { responsibleUserId: USER, status: "OPEN", type: "REPLY", fromDate: "2026-10-01", untilDate: "2026-10-31", agentUnchecked: true },
          p_row_count: 2,
          p_truncated: false,
        },
      ],
    ]);
    expect(JSON.stringify(calls.rpc)).not.toContain("Maria");
  });

  it("quem não é ADMIN não exporta: a agenda nem é lida e nada é registrado", async () => {
    for (const role of ["LAWYER", "ASSISTANT", "PARTNER_ADMIN"] as const) {
      const { db, calls } = stubDb({ rows: [row()] });
      expect(await rejected(service.exportDeadlines(ctxFor(role, db), listDeadlinesSchema.parse({})))).toBe("FORBIDDEN");
      expect([calls.table, calls.rpc]).toEqual([undefined, []]);
    }
  });
});
