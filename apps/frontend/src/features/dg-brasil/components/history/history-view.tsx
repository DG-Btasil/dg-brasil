"use client";

import { useMemo, useState } from "react";
import { History } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { useUserMap } from "@/features/offices/hooks";
import { daysSince } from "@/lib/clock";
import type { ChangeHistoryEntry } from "@/types";
import { useChangeHistory, useDgMaps } from "../../hooks";
import { dgRoutes, formatVersionChange } from "../../utils";
import { DiffDialog } from "../shared/diff-dialog";
import { HistoryEntry } from "./history-entry";
import { HistoryFilters, type HistoryFilterValue } from "./history-filters";

const INITIAL: HistoryFilterValue = { status: "", entity: "", period: "all" };

export function HistoryView() {
  const history = useChangeHistory();
  const maps = useDgMaps();
  const users = useUserMap();
  const [filters, setFilters] = useState<HistoryFilterValue>(INITIAL);
  const [diffEntry, setDiffEntry] = useState<ChangeHistoryEntry | null>(null);

  const filtered = useMemo(
    () =>
      history.filter(
        (h) =>
          (!filters.status || h.status === filters.status) &&
          (!filters.entity || h.entityType === filters.entity) &&
          (filters.period === "all" || daysSince(h.at) <= Number(filters.period)),
      ),
    [history, filters],
  );

  function entityHref(e: ChangeHistoryEntry): string | undefined {
    if (e.entityType === "SKILL" && maps.skills.has(e.entityId)) return dgRoutes.skill(e.entityId);
    if (e.entityType === "THESIS" && maps.theses.has(e.entityId)) return dgRoutes.thesis(e.entityId);
    if ((e.entityType === "AGENT" || e.entityType === "RULE") && maps.agents.has(e.entityId)) return dgRoutes.agent(e.entityId);
    return undefined;
  }

  const hasFilters = filters.status !== "" || filters.entity !== "" || filters.period !== "all";

  return (
    <section aria-labelledby="dg-history-title">
      <div className="mb-3">
        <h2 id="dg-history-title" className="text-[15px] font-semibold text-foreground">
          Histórico de alterações
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Toda mudança em agentes, Skills, teses e regras, com quem pediu, o que mudou e quem confirmou.</p>
      </div>
      <Panel>
        <HistoryFilters value={filters} onChange={setFilters} resultCount={filtered.length} />
        {filtered.length === 0 ? (
          <EmptyState
            icon={History}
            title={history.length === 0 ? "Nenhuma alteração registrada." : "Nenhuma alteração encontrada com esses filtros."}
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={() => setFilters(INITIAL)}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ol className="divide-y divide-line">
            {filtered.map((e) => (
              <HistoryEntry
                key={e.id}
                entry={e}
                requestedByName={users.get(e.requestedBy)?.name ?? "—"}
                entityHref={entityHref(e)}
                agents={e.affectedAgentIds.flatMap((id) => {
                  const a = maps.agents.get(id);
                  return a ? [{ id: a.id, name: a.name, href: dgRoutes.agent(a.id) }] : [];
                })}
                onShowDiff={() => setDiffEntry(e)}
              />
            ))}
          </ol>
        )}
      </Panel>
      <DiffDialog
        open={diffEntry !== null}
        onOpenChange={(v) => !v && setDiffEntry(null)}
        title={diffEntry ? `${diffEntry.entityName} · ${formatVersionChange(diffEntry.fromVersion, diffEntry.toVersion)}` : "Alterações"}
        description={diffEntry?.suggestedChange}
        lines={diffEntry?.diff ?? []}
      />
    </section>
  );
}
