"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  AlarmClock,
  Banknote,
  Bell,
  Bot,
  BriefcaseBusiness,
  ClipboardCheck,
  FileCheck2,
  FileWarning,
  Gavel,
  Inbox,
  PlugZap,
  ShieldAlert,
  TimerOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  NOTIFICATION_SEVERITY_LABEL,
  NOTIFICATION_SEVERITY_TONE,
  NOTIFICATION_TYPE_LABEL,
  type NotificationType,
} from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { useNotificationActions, useVisibleNotifications } from "@/features/notifications/hooks";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/states";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";

export const NOTIFICATION_TYPE_ICON: Record<NotificationType, LucideIcon> = {
  DEADLINE: AlarmClock,
  REVIEW_WAITING: ClipboardCheck,
  DOCUMENT_MISSING: FileWarning,
  PROCESS_MOVEMENT: Gavel,
  AGENT_INTERVENTION: Bot,
  INTEGRATION_ISSUE: PlugZap,
  TASK_OVERDUE: TimerOff,
  DATA_INTEGRITY: ShieldAlert,
  CASE_SUBMITTED: BriefcaseBusiness,
  CASE_DOCUMENTS_PENDING: FileWarning,
  CASE_READY_FOR_ANALYSIS: ClipboardCheck,
  CASE_WAITING_REVIEW: ClipboardCheck,
  CASE_ACCEPTED: BriefcaseBusiness,
  CASE_REJECTED: ShieldAlert,
  CASE_LAWYER_REQUIRED: AlarmClock,
  PARTNER_REQUEST: Inbox,
  DOCUMENT_APPROVED: FileCheck2,
  CASE_UPDATE: Gavel,
  PAYOUT_UPDATE: Banknote,
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const notifications = useVisibleNotifications();
  const { markRead, markAllRead } = useNotificationActions();
  const unread = notifications.filter((n) => !n.read).length;
  const list = filter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  useDismiss(ref, open, (reason) => {
    setOpen(false);
    if (reason === "escape") buttonRef.current?.focus();
  });

  return (
    <div ref={ref} className="relative" data-tour="notifications">
      <IconButton
        ref={buttonRef}
        label={unread ? `Notificações — ${unread} não lidas` : "Notificações"}
        variant="onDark"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-gold px-1 text-[10.5px] font-bold text-navy tabular ring-2 ring-navy">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </IconButton>

      {open && (
        <div
          role="dialog"
          aria-label="Central de notificações"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[440px] overflow-hidden rounded-lg border border-line bg-surface text-foreground shadow-overlay animate-panel-down"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <p className="text-[14px] font-semibold">Notificações</p>
              <p className="text-[12px] text-muted">{unread ? `${unread} não lidas` : "Tudo em dia"}</p>
            </div>
            <div className="flex items-center gap-1">
              <div role="group" aria-label="Filtro" className="flex rounded-md border border-line p-0.5">
                {(["unread", "all"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-sm px-2 py-1 text-[12px]", filter === f ? "bg-navy text-white" : "text-muted hover:text-foreground")}
                  >
                    {f === "unread" ? "Não lidas" : "Todas"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ul className="max-h-[440px] divide-y divide-line overflow-y-auto">
            {list.length === 0 && (
              <li>
                <EmptyState compact icon={Bell} title="Nenhuma notificação não lida" description="Alertas importantes para o seu trabalho aparecem aqui." />
              </li>
            )}
            {list.map((n) => {
              const Icon = NOTIFICATION_TYPE_ICON[n.type];
              const tone = NOTIFICATION_SEVERITY_TONE[n.severity];
              return (
                <li key={n.id} className={cn("border-l-2 px-4 py-3", n.read ? "border-l-transparent bg-surface" : cn("bg-surface-muted/60", TONE_BORDER_LEFT[tone]))}>
                  <div className="flex gap-3">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-subtle" : "text-navy-700")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("text-[13px] leading-snug", n.read ? "text-muted" : "font-semibold text-foreground")}>{n.title}</p>
                        <span className="shrink-0 text-[11px] text-subtle tabular">{formatEventTime(n.at)}</span>
                      </div>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{n.description}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge tone={tone} dot>
                          {NOTIFICATION_SEVERITY_LABEL[n.severity]}
                        </Badge>
                        <span className="text-[11.5px] text-subtle">{NOTIFICATION_TYPE_LABEL[n.type]}</span>
                        <span className="ml-auto flex items-center gap-3">
                          {!n.read && (
                            <button type="button" onClick={() => markRead(n.id)} className="text-[12px] text-muted hover:text-foreground">
                              Marcar como lida
                            </button>
                          )}
                          <Link
                            href={n.cta.href}
                            onClick={() => {
                              markRead(n.id);
                              setOpen(false);
                            }}
                            className="text-[12px] font-semibold text-navy-700 hover:underline underline-offset-2"
                          >
                            {n.cta.label}
                          </Link>
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {unread > 0 && (
            <div className="border-t border-line bg-surface-muted px-4 py-2.5 text-right">
              <button type="button" onClick={markAllRead} className="text-[12px] font-medium text-navy-700 hover:underline">
                Marcar todas como lidas
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
