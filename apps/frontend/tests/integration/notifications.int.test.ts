import { describe, expect, it } from "vitest";
import * as notifications from "@/server/domain/notifications/service";
import { listNotificationsSchema } from "@/server/domain/notifications/schemas";
import { ctxFor, expectDomainError, serviceDb, world, type WorldRole } from "./support/world";

/** Notificações no Supabase DEV real: cada um vê e marca só as próprias (RLS + aal2). Sem envio. */

/** Cenário: notificação criada pela service role (o backend é quem cria). */
async function notify(role: WorldRole, opts: { read?: boolean; title?: string } = {}): Promise<string> {
  const { data, error } = await serviceDb()
    .from("notifications")
    .insert({
      user_id: world.users[role].id,
      type: "INTEGRATION_TEST",
      title: opts.title ?? `Aviso ${world.run}`,
      message: "Mensagem de teste",
      severity: "WARNING",
      read_at: opts.read ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`notificação: ${error.message}`);
  return (data as { id: string }).id;
}

async function readAt(id: string): Promise<string | null> {
  const { data } = await serviceDb().from("notifications").select("read_at").eq("id", id).single();
  return (data as { read_at: string | null }).read_at;
}

describe("notificações", () => {
  it("usuário lista só as próprias, não lidas primeiro", async () => {
    const readId = await notify("LAWYER", { read: true });
    const unreadId = await notify("LAWYER");
    const othersId = await notify("ASSISTANT");

    const page = await notifications.listNotifications(await ctxFor("LAWYER"), listNotificationsSchema.parse({ pageSize: 50 }));
    const ids = page.items.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([readId, unreadId]));
    expect(ids).not.toContain(othersId);
    expect(page.items.find((n) => n.id === unreadId)).toMatchObject({ read: false, severity: "warning", type: "INTEGRATION_TEST" });
    // Nenhuma lida antes de uma não lida.
    const firstRead = page.items.findIndex((n) => n.read);
    if (firstRead >= 0) expect(page.items.slice(firstRead).every((n) => n.read)).toBe(true);

    const unreadOnly = await notifications.listNotifications(await ctxFor("LAWYER"), listNotificationsSchema.parse({ unreadOnly: true, pageSize: 50 }));
    expect(unreadOnly.items.every((n) => !n.read)).toBe(true);
  });

  it("marcar como lida: contador cai, é idempotente e grava read_at", async () => {
    const ctx = await ctxFor("ASSISTANT");
    const id = await notify("ASSISTANT");
    const before = (await notifications.countUnreadNotifications(ctx)).unread;
    await notifications.markNotificationRead(ctx, id);
    expect((await notifications.countUnreadNotifications(ctx)).unread).toBe(before - 1);
    expect(await readAt(id)).not.toBeNull();
    await notifications.markNotificationRead(ctx, id);
  });

  it("não marca notificação de outra pessoa (NOT_FOUND) e ela continua não lida", async () => {
    const othersId = await notify("ASSISTANT");
    await expectDomainError(notifications.markNotificationRead(await ctxFor("LAWYER"), othersId), "NOT_FOUND");
    await expectDomainError(notifications.markNotificationRead(await ctxFor("PARTNER_ADMIN_A"), othersId), "NOT_FOUND");
    expect(await readAt(othersId)).toBeNull();

    // Nem pelo client direto (RLS): nenhuma linha muda.
    const { count } = await (await ctxFor("LAWYER")).db.from("notifications").update({ read_at: new Date().toISOString() }, { count: "exact" }).eq("id", othersId);
    expect(count ?? 0).toBe(0);
    expect(await readAt(othersId)).toBeNull();
  });

  it("marcar todas só afeta as próprias", async () => {
    const mine = await notify("LAWYER");
    const others = await notify("ASSISTANT");
    const ctx = await ctxFor("LAWYER");
    const { updated } = await notifications.markAllNotificationsRead(ctx);
    expect(updated).toBeGreaterThanOrEqual(1);
    expect((await notifications.countUnreadNotifications(ctx)).unread).toBe(0);
    expect(await readAt(mine)).not.toBeNull();
    expect(await readAt(others)).toBeNull();
  });

  it("parceiro A não vê as de B", async () => {
    const a = await notify("PARTNER_USER_A");
    const b = await notify("PARTNER_USER_B");
    const page = await notifications.listNotifications(await ctxFor("PARTNER_USER_A"), listNotificationsSchema.parse({ pageSize: 50 }));
    const ids = page.items.map((n) => n.id);
    expect(ids).toContain(a);
    expect(ids).not.toContain(b);
  });
});
