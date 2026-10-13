import { describe, expect, it } from "vitest";
import { addDays, deadlineFromRows, deadlineInsertRow, deadlineUpdatePatch, dueAtFromInput, mergePage, officeLocalDate, type DeadlineRow } from "./mappers";
import { createDeadlineSchema, listUpcomingSchema, updateDeadlineSchema } from "./schemas";

const CASE = "00000000-0000-4000-8000-0000000000c1";
const PROC = "00000000-0000-4000-8000-0000000000d1";
const USER = "00000000-0000-4000-8000-0000000000b1";

const row = (over: Partial<DeadlineRow> = {}): DeadlineRow => ({
  id: "d1",
  legal_case_id: CASE,
  legal_process_id: PROC,
  title: "Réplica",
  deadline_type: "REPLY",
  description: null,
  due_at: "2026-10-10T20:00:00Z",
  priority: "HIGH",
  status: "OPEN",
  responsible_user_id: USER,
  source: "MANUAL",
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  completed_at: null,
  ...over,
});

describe("schemas de prazo", () => {
  it("caso obrigatório; processo opcional; exatamente uma forma de vencimento", () => {
    expect(createDeadlineSchema.safeParse({ title: "x", dueDate: "2026-10-20" }).success).toBe(false);
    const ok = createDeadlineSchema.parse({ legalCaseId: CASE, title: "x", dueDate: "2026-10-20" });
    expect(ok).toMatchObject({ type: "INTERNAL", priority: "NORMAL" });
    expect(ok.processId).toBeUndefined();
    expect(createDeadlineSchema.safeParse({ legalCaseId: CASE, title: "x" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ legalCaseId: CASE, title: "x", dueDate: "2026-10-20", dueAt: "2026-10-20T10:00:00Z" }).success).toBe(false);
    expect(createDeadlineSchema.safeParse({ legalCaseId: CASE, title: "x", dueDate: "20/10/2026" }).success).toBe(false);
  });

  it("status não é editável pelo PATCH (só complete/cancel/missed)", () => {
    const parsed = updateDeadlineSchema.parse({ id: CASE, patch: { title: "y", status: "COMPLETED" } });
    expect(parsed.patch).not.toHaveProperty("status");
    expect(updateDeadlineSchema.safeParse({ id: CASE, patch: {} }).success).toBe(false);
  });

  it("janela de próximos prazos limitada", () => {
    expect(listUpcomingSchema.parse({}).days).toBe(30);
    expect(listUpcomingSchema.safeParse({ days: 1000 }).success).toBe(false);
  });
});

describe("datas no fuso do escritório", () => {
  it("data civil vira fim do dia em Brasília", () => {
    expect(dueAtFromInput({ dueDate: "2026-10-20" })).toBe("2026-10-20T23:59:59-03:00");
    expect(dueAtFromInput({ dueAt: "2026-10-20T10:00:00Z" })).toBe("2026-10-20T10:00:00Z");
    expect(dueAtFromInput({})).toBeUndefined();
  });

  it("data local de São Paulo (02:00Z ainda é o dia anterior) e soma de dias", () => {
    expect(officeLocalDate(new Date("2026-10-13T02:00:00Z"))).toBe("2026-10-12");
    expect(officeLocalDate(new Date("2026-10-13T03:00:00Z"))).toBe("2026-10-13");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("mapeamento de prazo", () => {
  it("situação efetiva vem da view (OVERDUE derivado), status gravado preservado", () => {
    const dto = deadlineFromRows(row(), { deadline_id: "d1", effective_status: "OVERDUE", due_date_local: "2026-10-10" });
    expect(dto).toMatchObject({ status: "OPEN", effectiveStatus: "OVERDUE", dueDateLocal: "2026-10-10", processId: PROC, type: "REPLY" });
  });

  it("página: ordem da view, desempate pelo horário, linha ausente descartada", () => {
    const status = [
      { deadline_id: "a", effective_status: "OPEN" as const, due_date_local: "2026-10-20" },
      { deadline_id: "b", effective_status: "OPEN" as const, due_date_local: "2026-10-20" },
      { deadline_id: "gone", effective_status: "OPEN" as const, due_date_local: "2026-10-21" },
      { deadline_id: "c", effective_status: "OPEN" as const, due_date_local: "2026-10-22" },
    ];
    const rows = [
      row({ id: "c", due_at: "2026-10-22T12:00:00Z" }),
      row({ id: "a", due_at: "2026-10-20T20:00:00Z" }),
      row({ id: "b", due_at: "2026-10-20T13:00:00Z" }),
    ];
    expect(mergePage(status, rows).map((d) => d.id)).toEqual(["b", "a", "c"]);
  });

  it("insert: origem MANUAL, status não enviado (default OPEN), responsável padrão", () => {
    const input = createDeadlineSchema.parse({ legalCaseId: CASE, title: "Audiência", type: "HEARING", dueDate: "2026-11-05" });
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

  it("PATCH: só chaves presentes", () => {
    expect(deadlineUpdatePatch({ title: "Novo", dueDate: "2026-11-01", responsibleUserId: null })).toEqual({
      title: "Novo",
      due_at: "2026-11-01T23:59:59-03:00",
      responsible_user_id: null,
    });
  });
});
