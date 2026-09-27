"use client";

import { ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { NotAvailable } from "@/components/ui/tooltip";
import { useSubscription, useUsers } from "@/features/offices/hooks";
import type { Tone } from "@/lib/constants/status";
import { formatDate } from "@/lib/formatting";
import type { ImplementationStatus, SubscriptionStatus } from "@/types";
import { SectionHeader } from "../section-header";

const SUBSCRIPTION_LABEL: Record<SubscriptionStatus, string> = { ACTIVE: "Ativa", TRIAL: "Em avaliação", PAST_DUE: "Pagamento pendente", CANCELLED: "Cancelada" };
const SUBSCRIPTION_TONE: Record<SubscriptionStatus, Tone> = { ACTIVE: "success", TRIAL: "info", PAST_DUE: "warning", CANCELLED: "neutral" };
const IMPLEMENTATION_LABEL: Record<ImplementationStatus, string> = { NOT_STARTED: "Não iniciada", IN_PROGRESS: "Em andamento", COMPLETED: "Concluída" };
const IMPLEMENTATION_TONE: Record<ImplementationStatus, Tone> = { NOT_STARTED: "neutral", IN_PROGRESS: "gold", COMPLETED: "success" };

export function BillingSection() {
  const sub = useSubscription();
  const users = useUsers();
  const usedSeats = users.filter((u) => u.status !== "DISABLED").length;

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Assinatura"
        description="Plano contratado, situação da assinatura e implantação. Condições comerciais são tratadas com a equipe DG Brasil."
      />
      <Panel>
        <PanelHeader title={sub.planName} description="Dados de demonstração — nenhum valor é cobrado." />
        <PanelBody>
          <DefinitionGrid
            columns={3}
            items={[
              {
                label: "Situação da assinatura",
                value: (
                  <Badge tone={SUBSCRIPTION_TONE[sub.status]} dot>
                    {SUBSCRIPTION_LABEL[sub.status]}
                  </Badge>
                ),
              },
              {
                label: "Implantação",
                value: (
                  <Badge tone={IMPLEMENTATION_TONE[sub.implementationStatus]} dot>
                    {IMPLEMENTATION_LABEL[sub.implementationStatus]}
                  </Badge>
                ),
              },
              { label: "Próxima cobrança", value: sub.nextBillingAt ? formatDate(sub.nextBillingAt) : null },
              { label: "Assentos", value: <span className="tabular">{usedSeats} em uso de {sub.seats}</span> },
              { label: "Suporte", value: sub.supportContact },
              { label: "Valor", value: "Conforme proposta comercial" },
            ]}
          />
        </PanelBody>
        <PanelFooter className="justify-start">
          <NotAvailable>
            <Button size="sm" variant="secondary">
              Alterar plano
            </Button>
          </NotAvailable>
          <NotAvailable>
            <Button size="sm" variant="secondary">
              Adicionar assentos
            </Button>
          </NotAvailable>
          <NotAvailable>
            <Button size="sm" variant="ghost">
              Ver faturas
            </Button>
          </NotAvailable>
        </PanelFooter>
      </Panel>
      <Panel>
        <PanelHeader title="Implantação" description="Reveja as respostas dadas na implantação do escritório." />
        <PanelBody className="flex items-center justify-between gap-4">
          <p className="text-[13px] text-muted">Reabrir a implantação não apaga dados; permite revisar e ajustar as respostas.</p>
          <ButtonLink href="/onboarding" variant="secondary" size="sm" icon={<ClipboardList className="size-3.5" aria-hidden />}>
            Revisar implantação
          </ButtonLink>
        </PanelBody>
      </Panel>
    </div>
  );
}
