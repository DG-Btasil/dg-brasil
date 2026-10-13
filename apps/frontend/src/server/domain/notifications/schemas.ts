import { z } from "zod";
import { pageInputSchema } from "@/server/core/pagination";
import { zUuid } from "@/server/core/validation";

/**
 * Entrada das operações de notificação. Nenhuma aceita `userId`: o
 * destinatário é sempre o usuário da sessão (e a RLS confere de novo, com aal2).
 */

/** Ordenação fechada (não é nome de coluna): não lidas primeiro ou mais recentes primeiro. */
export const NOTIFICATION_ORDERS = ["UNREAD_FIRST", "NEWEST"] as const;
export type NotificationOrder = (typeof NOTIFICATION_ORDERS)[number];

export const listNotificationsSchema = pageInputSchema.extend({
  unreadOnly: z.boolean().default(false),
  order: z.enum(NOTIFICATION_ORDERS).default("UNREAD_FIRST"),
});
export type ListNotificationsInput = z.infer<typeof listNotificationsSchema>;

export const notificationIdSchema = z.object({ id: zUuid() });
