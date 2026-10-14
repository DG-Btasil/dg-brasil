"use client";

import { History } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/formatting";
import type { ActionResult } from "@/lib/actions/result";
import { useServerList } from "@/lib/hooks/use-server-list";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Timeline } from "@/components/ui/display";
import { Pagination } from "@/components/ui/pagination";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import { listAuditEventsAction } from "@/server/domain/audit/actions";
import type { AuditEventDTO } from "@/server/domain/audit/dto";
import { ACTOR_TYPE_LABEL, actionLabel, eventDetail } from "../humanize";
import { AUDIT_TIMELINE_PAGE_SIZE, auditTimelineInput } from "../query";

/**
 * Linha do tempo de auditoria de um registro (ADMIN, `audit.view`): trilha
 * do banco, paginada no servidor, em frases ("Caso aceito · de enviado para
 * aceito"), com quem fez e quando. Sem IP, user agent nem texto livre.
 */
export function AuditTimeline({
  entityId,
  initial,
  title = "Atividade",
  description = "Registro de auditoria, do mais recente ao mais antigo.",
}: {
  entityId: string;
  initial: ActionResult<Page<AuditEventDTO>>;
  title?: string;
  description?: string;
}) {
  const { query, setQuery, result, pending, retry } = useServerList({
    initialQuery: { page: 1 },
    initialResult: initial,
    load: (q: { page: number }) => listAuditEventsAction(auditTimelineInput(entityId, q.page)),
  });
  const page = result.ok ? result.data : undefined;
  return (
    <Panel className="max-w-[880px]">
      <PanelHeader title={title} description={description} />
      <div aria-busy={pending || undefined} className={cn("transition-opacity", pending && "opacity-60")}>
        {!result.ok ? (
          <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar a atividade." />
        ) : !page ? (
          <SkeletonRows rows={4} />
        ) : page.items.length === 0 ? (
          <EmptyState icon={History} title="Nenhuma atividade registrada." compact />
        ) : (
          <>
            <PanelBody>
              <Timeline
                items={page.items.map((e) => {
                  const detail = eventDetail(e);
                  return {
                    id: e.id,
                    title: actionLabel(e.action),
                    description: (
                      <>
                        {detail && <>{detail} · </>}
                        <span className="text-subtle">{e.actorName ?? ACTOR_TYPE_LABEL[e.actorType]}</span>
                      </>
                    ),
                    meta: formatDateTime(e.at),
                    tone: e.actorType === "AGENT" ? "navy" : "neutral",
                  };
                })}
              />
            </PanelBody>
            <Pagination page={page.page} pageSize={AUDIT_TIMELINE_PAGE_SIZE} total={page.total} disabled={pending} onPageChange={(p) => setQuery({ ...query, page: p })} noun={{ one: "evento", many: "eventos" }} />
          </>
        )}
      </div>
    </Panel>
  );
}
