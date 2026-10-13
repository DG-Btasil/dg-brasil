"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell } from "lucide-react";
import { NOTIFICATION_SEVERITY_TONE, NOTIFICATION_TYPE_LABEL } from "@/lib/constants/status";
import { formatCNPJ, formatDate, formatEventTime, formatPhone } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { ROLE_LABEL } from "@/lib/permissions";
import { cn } from "@/lib/cn";
import { Can, PageContainer } from "@/components/layout/guards";
import { NOTIFICATION_TYPE_ICON } from "@/components/layout/notification-center";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, PageHeader } from "@/components/ui/display";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";
import { EmptyState } from "@/components/feedback/states";
import { ActionErrorState } from "@/components/feedback/action-error";
import type { MyPartnerSettingsDTO, PartnerDetailDTO } from "@/server/domain/organizations/dto";
import { useClientSession } from "@/features/auth/session-context";
import { useNotificationActions, useVisibleNotifications } from "@/features/notifications/hooks";
import { UsersPanel } from "./portal-users";

/** Notificações do portal (somente as endereçadas ao próprio parceiro). */
export function PortalNotifications() {
  const notifications = useVisibleNotifications();
  const { markRead, markAllRead } = useNotificationActions();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = unreadOnly ? notifications.filter((n) => !n.read) : notifications;
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <PageContainer>
      <PageHeader
        title="Notificações"
        description="Solicitações, documentos aprovados, andamento e repasses dos seus casos."
        actions={
          unread > 0 && (
            <Button variant="secondary" onClick={markAllRead}>
              Marcar todas como lidas
            </Button>
          )
        }
      />
      <Panel>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          {[false, true].map((flag) => (
            <button
              key={String(flag)}
              type="button"
              aria-pressed={unreadOnly === flag}
              onClick={() => setUnreadOnly(flag)}
              className={cn("rounded-sm px-2.5 py-1 text-[12.5px]", unreadOnly === flag ? "bg-navy text-white" : "text-muted hover:text-foreground")}
            >
              {flag ? `Não lidas (${unread})` : "Todas"}
            </button>
          ))}
        </div>
        {list.length === 0 ? (
          <EmptyState compact icon={Bell} title="Nenhuma notificação." />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((n) => {
              const Icon = NOTIFICATION_TYPE_ICON[n.type];
              return (
                <li key={n.id} className={cn("flex gap-3 border-l-2 px-5 py-3", n.read ? "border-l-transparent" : TONE_BORDER_LEFT[NOTIFICATION_SEVERITY_TONE[n.severity]])}>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-subtle" : "text-navy-700")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={cn("text-[13px]", n.read ? "text-muted" : "font-semibold text-foreground")}>{n.title}</p>
                      <span className="shrink-0 text-[11.5px] text-subtle">{formatEventTime(n.at)}</span>
                    </div>
                    <p className="mt-0.5 text-[12.5px] text-muted">{n.description}</p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <Badge tone="neutral">{NOTIFICATION_TYPE_LABEL[n.type]}</Badge>
                      {!n.read && (
                        <button type="button" onClick={() => markRead(n.id)} className="text-[12px] text-muted hover:text-foreground">
                          Marcar como lida
                        </button>
                      )}
                      <Link href={n.cta.href} onClick={() => markRead(n.id)} className="text-[12px] font-semibold text-navy-700 hover:underline underline-offset-2">
                        {n.cta.label}
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </PageContainer>
  );
}

/**
 * Minha Conta: dados da SESSÃO real (nunca do mock), o cadastro do próprio
 * escritório (getMyPartnerOfficeAction → PartnerOwnOfficeDTO, sem nota
 * interna) e, para o administrador do parceiro, a divisão padrão vigente
 * (getMyPartnerSettingsAction, 027) e a gestão de usuários do escritório.
 */
export function PortalAccount({
  office,
  settings,
}: {
  office: ActionResult<PartnerDetailDTO>;
  /** Só PARTNER_ADMIN (partnerPortal.finance.view); ausente para PARTNER_USER. */
  settings?: ActionResult<MyPartnerSettingsDTO>;
}) {
  const session = useClientSession();
  if (!session) return null;
  const own = office.ok && office.data.access === "PARTNER" ? office.data.partner : undefined;
  return (
    <PageContainer>
      <PageHeader title="Minha Conta" description="Seus dados de acesso e as informações do seu escritório." />
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-5">
          <PanelHeader title="Seus dados" />
          <PanelBody className="flex items-start gap-4">
            <Avatar name={session.fullName} size="lg" />
            <DefinitionGrid
              columns={2}
              className="flex-1"
              items={[
                { label: "Nome", value: session.fullName },
                { label: "E-mail", value: session.email },
                { label: "Papel", value: ROLE_LABEL[session.role] },
                { label: "Cargo", value: session.jobTitle ?? undefined },
              ]}
            />
          </PanelBody>
        </Panel>
        <Panel className="col-span-12 xl:col-span-7">
          <PanelHeader title="Escritório" description="Para alterar estes dados, fale com a Bárbara Cardoso Advocacia." />
          {!office.ok ? (
            <ActionErrorState error={office} title="Não foi possível carregar o escritório." />
          ) : (
            <PanelBody>
              <DefinitionGrid
                items={[
                  { label: "Escritório", value: own?.name ?? session.organizationName },
                  { label: "Razão social", value: own?.legalName },
                  { label: "CNPJ", value: own?.cnpj ? formatCNPJ(own.cnpj) : undefined },
                  { label: "E-mail", value: own?.email },
                  { label: "Telefone", value: own?.phone ? formatPhone(own.phone) : undefined },
                  { label: "Parceria desde", value: settings?.ok && settings.data.activatedAt ? formatDate(settings.data.activatedAt) : own ? formatDate(own.createdAt) : undefined },
                ]}
              />
            </PanelBody>
          )}
        </Panel>
        {settings && (
          <Panel className="col-span-12 xl:col-span-5">
            <PanelHeader title="Divisão padrão" description="Vale para novos casos. Casos já aceitos mantêm o acordo registrado no aceite." />
            {!settings.ok ? (
              <ActionErrorState error={settings} title="Não foi possível carregar a divisão." />
            ) : (
              <PanelBody>
                <DefinitionGrid
                  columns={2}
                  items={[
                    { label: "Seu escritório", value: `${settings.data.partnerPercentage}%` },
                    { label: "Bárbara Cardoso Advocacia", value: `${settings.data.ownerPercentage}%` },
                  ]}
                />
              </PanelBody>
            )}
          </Panel>
        )}
        <Can permission="partnerPortal.users.manage">
          <div className="col-span-12">
            <UsersPanel />
          </div>
        </Can>
      </div>
    </PageContainer>
  );
}
