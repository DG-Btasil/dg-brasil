import { NOTIFICATION_TYPE_LABEL, type NotificationType } from "@/lib/constants/status";
import type { NotificationDTO } from "@/server/domain/notifications/dto";

/**
 * Notificação do banco → apresentação. O banco guarda o `type` (texto em
 * MAIÚSCULAS, aberto) e as referências (caso, processo, solicitação); o
 * destino e o rótulo são decisão da tela. Puro e testado.
 */

export function notificationTypeLabel(type: string): string {
  return (NOTIFICATION_TYPE_LABEL as Record<string, string>)[type] ?? "Notificação";
}

export function isKnownType(type: string): type is NotificationType {
  return type in NOTIFICATION_TYPE_LABEL;
}

/** Para onde a notificação leva (o mais específico primeiro). Sem referência: nenhum link. */
export function notificationTarget(
  n: Pick<NotificationDTO, "legalCaseId" | "processId" | "partnerRequestId" | "relatedType" | "relatedId">,
  audience: "INTERNAL" | "PARTNER",
): { href: string; label: string } | undefined {
  // Destino específico (037). O parceiro só recebe tipos que ele pode abrir.
  if (n.relatedType && n.relatedId) {
    if (n.relatedType === "review" && audience === "INTERNAL") return { href: `/revisoes/${n.relatedId}`, label: "Abrir revisão" };
    if (n.relatedType === "analysis" && audience === "INTERNAL" && n.legalCaseId) return { href: `/casos/${n.legalCaseId}?aba=analise`, label: "Ver análise" };
    if (n.relatedType === "transfer") return { href: "/financeiro", label: "Ver repasses" };
    if (n.relatedType === "agent_run" && audience === "INTERNAL") {
      return n.legalCaseId ? { href: `/casos/${n.legalCaseId}?aba=analise`, label: "Ver execução" } : { href: "/dg-brasil/execucoes", label: "Ver execuções" };
    }
    if (n.relatedType === "deadline" && audience === "INTERNAL") {
      if (n.processId) return { href: `/processos/${n.processId}?aba=prazos`, label: "Ver prazo" };
      if (n.legalCaseId) return { href: `/casos/${n.legalCaseId}`, label: "Ver caso" };
    }
  }
  if (n.partnerRequestId) {
    if (audience === "PARTNER") return { href: "/pendencias", label: "Ver pendências" };
    if (n.legalCaseId) return { href: `/casos/${n.legalCaseId}?aba=documentos`, label: "Ver solicitação" };
  }
  if (n.processId) return { href: `/processos/${n.processId}`, label: "Ver processo" };
  if (n.legalCaseId) return { href: `/casos/${n.legalCaseId}`, label: "Ver caso" };
  return undefined;
}
