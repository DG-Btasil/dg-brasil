import type { NotificationSeverity, NotificationType } from "@/lib/constants/status";
import type { Permission } from "@/lib/permissions";
import type { ID, ISODateTime, OfficeScoped } from "./common";

export interface Notification extends OfficeScoped {
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  at: ISODateTime;
  read: boolean;
  clientId?: ID;
  processId?: ID;
  reviewId?: ID;
  cta: { label: string; href: string };
  /** Permissão exigida para ver o alerta. Alertas administrativos não chegam a outros papéis. */
  requiredPermission: Permission;
}
