"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { NOTIFICATION_SEVERITY_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { useServerList } from "@/lib/hooks/use-server-list";
import { PageContainer } from "@/components/layout/guards";
import { notificationIcon } from "@/components/layout/notification-center";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { TONE_BORDER_LEFT } from "@/components/ui/tone";
import type { Page } from "@/server/core/pagination";
import { listNotificationsAction, markAllNotificationsReadAction, markNotificationReadAction } from "@/server/domain/notifications/actions";
import type { NotificationDTO } from "@/server/domain/notifications/dto";
import { useClientSession } from "@/features/auth/session-context";
import { notificationTarget, notificationTypeLabel } from "../presentation";

const PAGE_SIZE = 25;
type Query = { unreadOnly: boolean; page: number };

const notificationsInput = (q: Query) => ({ unreadOnly: q.unreadOnly, page: q.page, pageSize: PAGE_SIZE });

/** Caixa de notificações do usuário (página inteira), paginada no servidor. */
export function NotificationsPage({ initialResult }: { initialResult: ActionResult<Page<NotificationDTO>> }) {
  const router = useRouter();
  const failed = useActionFeedback();
  const session = useClientSession();
  const audience = session?.surface === "PARTNER" ? "PARTNER" : "INTERNAL";
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery: { unreadOnly: false, page: 1 } as Query,
    initialResult,
    load: (q: Query) => listNotificationsAction(notificationsInput(q)),
  });
  const page = result.ok ? result.data : undefined;

  async function run(call: () => Promise<ActionResult<unknown>>, failure: string) {
    const r = await callAction(call);
    if (!r.ok) failed(r, failure);
    retry();
    router.refresh();
  }

  return (
    <PageContainer>
      <PageHeader
        title="Notificações"
        description="Solicitações, documentos, andamento e repasses dos seus casos."
        actions={
          <Button variant="secondary" onClick={() => run(() => markAllNotificationsReadAction(), "Não foi possível marcar as notificações.")}>
            Marcar todas como lidas
          </Button>
        }
      />
      <Panel>
        <div className="flex items-center gap-2 border-b border-line px-5 py-3" role="group" aria-label="Filtro">
          {[false, true].map((flag) => (
            <button
              key={String(flag)}
              type="button"
              aria-pressed={query.unreadOnly === flag}
              onClick={() => setQuery({ unreadOnly: flag, page: 1 })}
              className={cn("rounded-sm px-2.5 py-1 text-[12.5px]", query.unreadOnly === flag ? "bg-navy text-white" : "text-muted hover:text-foreground")}
            >
              {flag ? "Não lidas" : "Todas"}
            </button>
          ))}
        </div>
        <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
          {!result.ok ? (
            <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar as notificações." />
          ) : !page ? (
            <SkeletonRows rows={4} />
          ) : page.items.length === 0 ? (
            <EmptyState compact icon={Bell} title="Nenhuma notificação." />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {page.items.map((n) => {
                  const Icon = notificationIcon(n.type);
                  const target = notificationTarget(n, audience);
                  return (
                    <li key={n.id} className={cn("flex gap-3 border-l-2 px-5 py-3", n.read ? "border-l-transparent" : TONE_BORDER_LEFT[NOTIFICATION_SEVERITY_TONE[n.severity]])}>
                      <Icon className={cn("mt-0.5 size-4 shrink-0", n.read ? "text-subtle" : "text-navy-700")} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className={cn("text-[13px]", n.read ? "text-muted" : "font-semibold text-foreground")}>{n.title}</p>
                          <span className="shrink-0 text-[11.5px] text-subtle">{formatEventTime(n.createdAt)}</span>
                        </div>
                        {n.message && <p className="mt-0.5 text-[12.5px] text-muted">{n.message}</p>}
                        <div className="mt-1.5 flex items-center gap-3">
                          <Badge tone="neutral">{notificationTypeLabel(n.type)}</Badge>
                          {!n.read && (
                            <button type="button" onClick={() => run(() => markNotificationReadAction({ id: n.id }), "Não foi possível marcar como lida.")} className="text-[12px] text-muted hover:text-foreground">
                              Marcar como lida
                            </button>
                          )}
                          {target && (
                            <Link href={target.href} className="text-[12px] font-semibold text-navy-700 hover:underline underline-offset-2">
                              {target.label}
                            </Link>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination page={page.page} pageSize={PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "notificação", many: "notificações" }} />
            </>
          )}
        </div>
      </Panel>
    </PageContainer>
  );
}
