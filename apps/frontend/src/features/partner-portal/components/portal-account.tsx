"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell } from "lucide-react";
import { NOTIFICATION_SEVERITY_TONE, NOTIFICATION_TYPE_LABEL } from "@/lib/constants/status";
import { formatDate, formatEventTime, formatPhone } from "@/lib/formatting";
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
import { useCurrentPartnerOffice, useCurrentUser } from "@/features/auth/hooks";
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

/** Minha Conta: dados do usuário, do escritório e (Partner Admin) usuários do escritório. */
export function PortalAccount() {
  const user = useCurrentUser();
  const office = useCurrentPartnerOffice();
  if (!user) return null;
  return (
    <PageContainer>
      <PageHeader title="Minha Conta" description="Seus dados de acesso e as informações do seu escritório." />
      <div className="grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-5">
          <PanelHeader title="Seus dados" />
          <PanelBody className="flex items-start gap-4">
            <Avatar name={user.name} size="lg" />
            <DefinitionGrid
              columns={2}
              className="flex-1"
              items={[
                { label: "Nome", value: user.name },
                { label: "E-mail", value: user.email },
                { label: "Papel", value: ROLE_LABEL[user.role] },
                { label: "OAB", value: user.oab },
                { label: "Último acesso", value: user.lastAccessAt ? formatEventTime(user.lastAccessAt) : undefined },
              ]}
            />
          </PanelBody>
        </Panel>
        {office && (
          <Panel className="col-span-12 xl:col-span-7">
            <PanelHeader title="Escritório" description="Para alterar estes dados, fale com a Bárbara Cardoso Advocacia." />
            <PanelBody>
              <DefinitionGrid
                items={[
                  { label: "Escritório", value: office.name },
                  { label: "Responsável", value: `${office.responsibleName} · OAB/${office.oabState} ${office.responsibleOab}` },
                  { label: "E-mail", value: office.email },
                  { label: "Telefone", value: formatPhone(office.phone) },
                  { label: "Parceria desde", value: formatDate(office.activatedAt ?? office.createdAt) },
                ]}
              />
            </PanelBody>
          </Panel>
        )}
        <Can permission="partnerPortal.users.manage">
          {office && (
            <div className="col-span-12">
              <UsersPanel partnerOfficeId={office.id} />
            </div>
          )}
        </Can>
      </div>
    </PageContainer>
  );
}
