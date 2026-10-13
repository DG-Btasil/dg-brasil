import type { ServiceContext } from "@/server/core/context";
import { notFound } from "@/server/core/errors";
import { toPage, type Page } from "@/server/core/pagination";
import type { MarkAllReadDTO, NotificationDTO, UnreadCountDTO } from "./dto";
import { notificationFromRow } from "./mappers";
import * as repo from "./repository";
import type { ListNotificationsInput } from "./schemas";

/**
 * Notificações in-app: cada pessoa lê e marca como lidas SÓ as próprias
 * (interno ou parceiro — não há permissão da matriz: é a caixa do usuário).
 * O destinatário é sempre `ctx.session.userId`; a RLS repete a regra com aal2.
 * Não há envio aqui: notificações são criadas pelo backend/worker.
 */

export async function listNotifications(ctx: ServiceContext, input: ListNotificationsInput): Promise<Page<NotificationDTO>> {
  const { rows, total } = await repo.list(ctx.db, ctx.session.userId, { unreadOnly: input.unreadOnly, order: input.order }, input);
  return toPage(rows.map(notificationFromRow), total, input);
}

export async function countUnreadNotifications(ctx: ServiceContext): Promise<UnreadCountDTO> {
  return { unread: await repo.countUnread(ctx.db, ctx.session.userId) };
}

/**
 * Marca como lida. Idempotente para a própria notificação já lida.
 * Notificação de outra pessoa é "não encontrada" (a RLS nem a deixa ver).
 */
export async function markNotificationRead(ctx: ServiceContext, id: string): Promise<void> {
  const changed = await repo.markRead(ctx.db, ctx.session.userId, id, new Date().toISOString());
  if (changed === 0 && !(await repo.exists(ctx.db, ctx.session.userId, id))) throw notFound("Notificação não encontrada.");
}

export async function markAllNotificationsRead(ctx: ServiceContext): Promise<MarkAllReadDTO> {
  const updated = await repo.markAllRead(ctx.db, ctx.session.userId, new Date().toISOString());
  ctx.log.info("notifications.marked_all_read", { updated });
  return { updated };
}
