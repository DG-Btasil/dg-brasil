import { describe, expect, it } from "vitest";
import { notificationFromRow, type NotificationRow } from "./mappers";
import { listNotificationsSchema, notificationIdSchema } from "./schemas";

const row = (over: Partial<NotificationRow> = {}): NotificationRow => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "DEADLINE",
  title: "Prazo amanhã",
  message: null,
  severity: "URGENT",
  legal_case_id: "00000000-0000-4000-8000-0000000000bb",
  legal_process_id: null,
  partner_request_id: null,
  read_at: null,
  created_at: "2026-10-10T12:00:00Z",
  ...over,
});

describe("notificação banco → DTO", () => {
  it("severidade no vocabulário do front; não lida", () => {
    const dto = notificationFromRow(row());
    expect(dto).toMatchObject({ severity: "urgent", read: false, legalCaseId: "00000000-0000-4000-8000-0000000000bb" });
    expect(dto.message).toBeUndefined();
    expect(dto.readAt).toBeUndefined();
  });

  it("lida quando read_at existe; DTO não tem user_id", () => {
    const dto = notificationFromRow(row({ read_at: "2026-10-11T00:00:00Z" }));
    expect(dto.read).toBe(true);
    expect(dto).not.toHaveProperty("userId");
    expect(dto).not.toHaveProperty("user_id");
  });
});

describe("schemas de notificação", () => {
  it("padrões: não lidas primeiro, todas", () => {
    expect(listNotificationsSchema.parse({})).toMatchObject({ order: "UNREAD_FIRST", unreadOnly: false, page: 1, pageSize: 25 });
  });

  it("ordem fora da lista e userId do navegador não passam", () => {
    expect(listNotificationsSchema.safeParse({ order: "user_id" }).success).toBe(false);
    expect(listNotificationsSchema.parse({ userId: "x" })).not.toHaveProperty("userId");
    expect(notificationIdSchema.safeParse({ id: "1" }).success).toBe(false);
  });

  it("unreadOnly não aceita texto ('false' não vira true)", () => {
    expect(listNotificationsSchema.safeParse({ unreadOnly: "false" }).success).toBe(false);
  });
});
