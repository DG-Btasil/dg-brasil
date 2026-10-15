"use client";

import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { formatDateTime } from "@/lib/formatting";
import { callAction, type ActionError } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { getPartnerCaseTimelineAction } from "@/server/domain/cases/actions";
import type { PartnerTimelineItemDTO } from "@/server/domain/cases/partner-timeline";
import { timelineTone } from "../timeline";

const PAGE_SIZE = 25;

/**
 * Histórico do caso no portal (4.3.1): eventos que o escritório parceiro pode
 * conhecer, montados pelo servidor (nada de auditoria interna). Paginado:
 * 25 por vez, "Carregar mais" busca a próxima página.
 */
export function PortalCaseHistory({ legalCaseId }: { legalCaseId: string }) {
  const [items, setItems] = useState<PartnerTimelineItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActionError | null>(null);

  const load = useCallback(
    async (next: number) => {
      setLoading(true);
      setError(null);
      const r = await callAction(() => getPartnerCaseTimelineAction({ legalCaseId, page: next, pageSize: PAGE_SIZE }));
      setLoading(false);
      if (!r.ok) {
        setError(r);
        return;
      }
      setItems((prev) => (next === 1 ? r.data.items : [...prev, ...r.data.items]));
      setTotal(r.data.total);
      setPage(next);
    },
    [legalCaseId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- primeira página ao abrir a aba
    void load(1);
  }, [load]);

  return (
    <Panel>
      <PanelHeader title="Histórico" description="O que aconteceu neste caso e que o seu escritório pode acompanhar." />
      <PanelBody>
        {error && items.length === 0 ? (
          <ActionErrorState error={error} onRetry={() => load(1)} title="Não foi possível carregar o histórico." />
        ) : loading && items.length === 0 ? (
          <SkeletonRows rows={4} />
        ) : items.length === 0 ? (
          <EmptyState compact icon={History} title="Ainda não há eventos neste caso." />
        ) : (
          <div className="space-y-4">
            <Timeline
              items={items.map((e) => ({
                id: e.id,
                title: e.title,
                meta: [formatDateTime(e.occurredAt), e.actorLabel].filter(Boolean).join(" · "),
                description: e.description,
                tone: timelineTone(e.kind),
                highlight: e.kind === "CASE_STATUS",
              }))}
            />
            {error && <ActionErrorState error={error} onRetry={() => load(page + 1)} title="Não foi possível carregar mais eventos." />}
            {items.length < total && (
              <div className="flex items-center justify-between border-t border-line pt-3">
                <span className="text-[12px] text-muted">
                  {items.length} de {total} eventos
                </span>
                <Button size="sm" variant="secondary" loading={loading} onClick={() => load(page + 1)}>
                  Carregar mais
                </Button>
              </div>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
