"use client";

import { NotificationPreferences } from "@/features/notifications/components/notification-preferences";
import { SectionHeader } from "../section-header";

/** Preferências de aviso do próprio usuário, lidas e gravadas no servidor (4.3.1). */
export function NotificationsSection() {
  return (
    <div>
      <SectionHeader title="Notificações" description="Como você quer ser avisado. As preferências valem apenas para o seu usuário." />
      <NotificationPreferences />
    </div>
  );
}
