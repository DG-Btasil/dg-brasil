"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { NOTIFICATION_SEVERITY_LABEL, NOTIFICATION_SEVERITY_TONE, type NotificationType } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useDismiss } from "@/lib/hooks/use-dismiss";
import { useClientSession } from "@/features/auth/session-context";
import { isKnownType, notificationTarget, notificationTypeLabel } from "@/features/notifications/presentation";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";
import type { Page } from "@/server/core/pagination";
import { countUnreadNotificationsAction, listNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction } from "@/server/domain/notifications/actions";
import type { NotificationDTO } from "@/server/domain/notifications/dto";

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
  CASE_ASSIGNED: BriefcaseBusiness,
  DEADLINE_CREATED: AlarmClock,
  DEADLINE_ASSIGNED: AlarmClock,
  DEADLINE_DUE_SOON: AlarmClock,
  DEADLINE_OVERDUE: TimerOff,
  DOCUMENT_REQUESTED: FileWarning,
  DOCUMENT_RECEIVED: FileCheck2,
  REVIEW_ASSIGNED: ClipboardCheck,
  REVIEW_DECIDED: ClipboardCheck,
  PARTNER_REQUEST_CREATED: Inbox,
  PARTNER_REQUEST_REPLY: Inbox,
  ANALYSIS_SENT: Bot,
  ANALYSIS_READY_FOR_REVIEW: ClipboardCheck,
  ANALYSIS_COMPLETED: Bot,
  ANALYSIS_FAILED: Bot,
  AGENT_RUN_ATTENTION: Bot,
  PARTNER_TRANSFER_REGISTERED: Banknote,
  PARTNER_TRANSFER_PAID: Banknote,
  MFA_RESET: ShieldAlert,
  ROLE_CHANGED: ShieldAlert,
};

/** Ícone do tipo; tipo novo do banco (texto aberto) usa o sino. */
export const notificationIcon = (type: string): LucideIcon => (isKnownType(type) ? NOTIFICATION_TYPE_ICON[type] : Bell);

/**
 * Sino do cabeçalho: caixa REAL do usuário da sessão (interno ou parceiro;
 * o destinatário vem da sessão, a RLS confere). Contagem ao carregar, lista
 * lida do servidor ao abrir; marcar como lida(s) pelo servidor, e a tela
 * atualiza depois da resposta.
 */
export function NotificationCenter() {
  const session = useClientSession();
  const failed = useActionFeedback();
  const audience = session?.surface === "PARTNER" ? "PARTNER" : "INTERNAL";
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [unread, setUnread] = useState(0);
  const [list, setList] = useState<ActionResult<Page<NotificationDTO>> | null>(null);
  const [version, setVersion] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => countUnreadNotificationsAction()).then((r) => {
      if (alive && r.ok) setUnread(r.data.unread);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    callAction(() => listNotificationsAction({ unreadOnly: filter === "unread", pageSize: 20 })).then((r) => {
      if (alive) setList(r);
    });
    return () => {
      alive = false;
    };
  }, [open, filter, version]);

  useDismiss(ref, open, (reason) => {
    setOpen(false);
    if (reason === "escape") buttonRef.current?.focus();
  });

  async function markRead(id: string) {
    const r = await callAction(() => markNotificationReadAction({ id }));
    if (!r.ok) failed(r, "Não foi possível marcar como lida.");
    refresh();
  }
  async function markAllRead() {
    const r = await callAction(() => markAllNotificationsReadAction());
    if (!r.ok) failed(r, "Não foi possível marcar as notificações.");
    refresh();
  }

  const items = list?.ok ? list.data.items : [];

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

          <ul className="max-h-[440px] divide-y divide-line overflow-y-auto" aria-busy={!list || undefined}>
            {!list ? (
              <li className="px-4 py-3">
                <SkeletonRows rows={3} />
              </li>
            ) : !list.ok ? (
              <li>
                <ActionErrorState error={list} onRetry={refresh} title="Não foi possível carregar as notificações." />
              </li>
            ) : items.length === 0 ? (
              <li>
                <EmptyState
                  compact
                  icon={Bell}
                  title={filter === "unread" ? "Nenhuma notificação não lida" : "Nenhuma notificação"}
                  description="Alertas importantes para o seu trabalho aparecem aqui."
                />
              </li>
            ) : (
              items.map((n) => {
                const Icon = notificationIcon(n.type);
                const tone = NOTIFICATION_SEVERITY_TONE[n.severity];
                const target = notificationTarget(n, audience);
                return (
                  <li key={n.id} className={cn("border-l-2 px-4 py-3", n.read ? "border-l-transparent bg-surface" : cn("bg-surface-muted/60", TONE_BORDER_LEFT[tone]))}>
                    <div className="flex gap-3">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-subtle" : "text-navy-700")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn("text-[13px] leading-snug", n.read ? "text-muted" : "font-semibold text-foreground")}>{n.title}</p>
                          <span className="shrink-0 text-[11px] text-subtle tabular">{formatEventTime(n.createdAt)}</span>
                        </div>
                        {n.message && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{n.message}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          <Badge tone={tone} dot>
                            {NOTIFICATION_SEVERITY_LABEL[n.severity]}
                          </Badge>
                          <span className="text-[11.5px] text-subtle">{notificationTypeLabel(n.type)}</span>
                          <span className="ml-auto flex items-center gap-3">
                            {!n.read && (
                              <button type="button" onClick={() => markRead(n.id)} className="text-[12px] text-muted hover:text-foreground">
                                Marcar como lida
                              </button>
                            )}
                            {target && (
                              <Link
                                href={target.href}
                                onClick={() => {
                                  if (!n.read) void markRead(n.id);
                                  setOpen(false);
                                }}
                                className="text-[12px] font-semibold text-navy-700 hover:underline underline-offset-2"
                              >
                                {target.label}
                              </Link>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
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
