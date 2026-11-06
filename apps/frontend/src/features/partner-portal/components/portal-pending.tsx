"use client";

import type { ActionResult } from "@/lib/actions/result";
import { PageContainer } from "@/components/layout/guards";
import { PageHeader } from "@/components/ui/display";
import type { Page } from "@/server/core/pagination";
import type { PartnerRequestListItem } from "@/server/domain/partner-requests/dto";
import { RequestsPanel } from "@/features/partner-requests/components/requests-panel";

/**
 * Pendências: solicitações da Bárbara Cardoso Advocacia ao escritório
 * parceiro (RLS recorta ao próprio escritório; escopo vazio = "as minhas").
 * Documentos são enviados na aba Documentos do caso.
 */
export function PortalPending({ initial }: { initial: ActionResult<Page<PartnerRequestListItem>> }) {
  return (
    <PageContainer>
      <PageHeader title="Pendências" description="Solicitações da Bárbara Cardoso Advocacia. Abra a conversa para responder e anexar o documento pedido — ele vai direto para o caso." />
      <RequestsPanel scope={{}} initial={initial} title="Solicitações" />
    </PageContainer>
  );
}
