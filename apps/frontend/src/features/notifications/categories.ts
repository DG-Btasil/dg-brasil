import type { Permission } from "@/lib/permissions";
import type { NotificationCategory } from "@/server/domain/notifications/preferences";

/**
 * Categorias de aviso (4.3.1) — rótulo, o que cobre e quem as recebe. O banco
 * decide quem recebe cada aviso; aqui só se mostra a preferência de quem pode
 * receber aquela categoria (ex.: ASSISTANT não tem revisões; parceiro não tem
 * prazos internos; financeiro do portal só PARTNER_ADMIN).
 */
export const CATEGORY_INFO: Record<NotificationCategory, { label: string; description: string }> = {
  CASES: { label: "Casos", description: "Novo caso enviado, caso atribuído a você, aceite e recusa." },
  DEADLINES: { label: "Prazos", description: "Prazo novo ou atribuído a você, prazo próximo (48 h) e vencido." },
  DOCUMENTS: { label: "Documentos", description: "Documento solicitado ao escritório parceiro e documento recebido." },
  REVIEWS: { label: "Revisões", description: "Revisão atribuída a você e decisão sobre o que você enviou." },
  PARTNER_REQUESTS: { label: "Solicitações", description: "Solicitação nova e respostas na conversa." },
  ANALYSES: { label: "Análises", description: "Análise enviada ao agente, aguardando revisão, concluída ou com falha." },
  FINANCE: { label: "Financeiro", description: "Repasse registrado e repasse pago." },
  SECURITY: { label: "Segurança da conta", description: "Redefinição do autenticador e mudança do seu perfil de acesso. Sempre ativo." },
};

const ORDER: NotificationCategory[] = ["CASES", "DEADLINES", "DOCUMENTS", "REVIEWS", "PARTNER_REQUESTS", "ANALYSES", "FINANCE", "SECURITY"];

/** Categorias que fazem sentido para quem está logado (as demais nunca chegariam). */
export function visibleCategories(surface: "INTERNAL" | "PARTNER", can: (p: Permission) => boolean): NotificationCategory[] {
  return ORDER.filter((c) => {
    switch (c) {
      case "DEADLINES":
        return surface === "INTERNAL";
      case "REVIEWS":
        return surface === "INTERNAL" && can("reviews.view");
      case "ANALYSES":
        return surface === "INTERNAL" && can("analyses.start");
      case "FINANCE":
        return surface === "PARTNER" && can("partnerPortal.finance.view");
      default:
        return true;
    }
  });
}
