import { NOTIFICATION_SEVERITY_FROM_DB, type DbNotificationSeverity } from "@/repositories/api/db-mappings";
import type { NotificationDTO } from "./dto";

/** Banco (snake_case) → domínio (camelCase). Função pura, testada em notifications.test.ts. */

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  severity: DbNotificationSeverity;
  legal_case_id: string | null;
  legal_process_id: string | null;
  partner_request_id: string | null;
  read_at: string | null;
  created_at: string;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

export function notificationFromRow(row: NotificationRow): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    severity: NOTIFICATION_SEVERITY_FROM_DB[row.severity] ?? "info",
    title: row.title,
    message: opt(row.message),
    read: row.read_at !== null,
    readAt: opt(row.read_at),
    createdAt: row.created_at,
    legalCaseId: opt(row.legal_case_id),
    processId: opt(row.legal_process_id),
    partnerRequestId: opt(row.partner_request_id),
  };
}
