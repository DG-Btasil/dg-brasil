"use client";

import { useMemo } from "react";
import { SEVERITY_WEIGHT } from "@/lib/constants/status";
import { useCan } from "@/features/auth/hooks";
import { useAppStore } from "@/store/app-store";
import { useScopedStore } from "@/store/scope";
import type { Notification } from "@/types";

/**
 * Notificações que o usuário atual pode ver, das mais urgentes para as
 * menos urgentes (não lidas primeiro). Filtradas por permissão ANTES de
 * renderizar: alertas administrativos nunca chegam ao DOM de outros papéis.
 */
export function useVisibleNotifications(): Notification[] {
  const notifications = useScopedStore((s) => s.notifications);
  const can = useCan();
  return useMemo(
    () =>
      notifications
        .filter((n) => can(n.requiredPermission))
        .sort((a, b) => {
          if (a.read !== b.read) return a.read ? 1 : -1;
          const sev = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
          return sev !== 0 ? sev : b.at.localeCompare(a.at);
        }),
    [notifications, can],
  );
}

export function useUnreadCount(): number {
  const visible = useVisibleNotifications();
  return visible.filter((n) => !n.read).length;
}

export function useNotificationActions() {
  const markRead = useAppStore((s) => s.markNotificationRead);
  const markAllRead = useAppStore((s) => s.markAllNotificationsRead);
  return { markRead, markAllRead };
}
