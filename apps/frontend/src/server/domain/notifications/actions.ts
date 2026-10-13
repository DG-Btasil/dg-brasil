"use server";

import { z } from "zod";
import { runAction } from "@/server/core/action";
import * as service from "./service";
import { listNotificationsSchema, notificationIdSchema } from "./schemas";

/**
 * Server Actions de notificação. Sem permissão da matriz: toda sessão
 * liberada (aal2, termos) tem a própria caixa. Nenhuma recebe `userId`.
 */

const noInput = z.object({}).optional();

export async function listNotificationsAction(input: unknown) {
  return runAction({ name: "notifications.list", schema: listNotificationsSchema, input, handler: service.listNotifications });
}

export async function countUnreadNotificationsAction(input?: unknown) {
  return runAction({ name: "notifications.unread_count", schema: noInput, input, handler: (ctx) => service.countUnreadNotifications(ctx) });
}

export async function markNotificationReadAction(input: unknown) {
  return runAction({ name: "notifications.mark_read", schema: notificationIdSchema, input, handler: (ctx, { id }) => service.markNotificationRead(ctx, id) });
}

export async function markAllNotificationsReadAction(input?: unknown) {
  return runAction({ name: "notifications.mark_all_read", schema: noInput, input, handler: (ctx) => service.markAllNotificationsRead(ctx) });
}
