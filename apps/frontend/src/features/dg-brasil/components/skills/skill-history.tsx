"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useUserMap } from "@/features/offices/hooks";
import { CHANGE_STATUS_LABEL, CHANGE_STATUS_TONE } from "@/lib/constants/status";
import { formatDateTime } from "@/lib/formatting";
import type { ChangeHistoryEntry } from "@/types";
import { formatVersionChange } from "../../utils";
import { DiffDialog } from "../shared/diff-dialog";

export function SkillHistory({ entries }: { entries: ChangeHistoryEntry[] }) {
  const users = useUserMap();
  const [open, setOpen] = useState<ChangeHistoryEntry | null>(null);

  return (
    <Panel>
      <PanelHeader title="Histórico de alterações" description="Mudanças registradas nesta Skill, mais recentes primeiro." />
      {entries.length === 0 ? (
        <EmptyState compact icon={History} title="Nenhuma alteração registrada." />
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((e) => (
            <li key={e.id} id={e.id} className="flex items-start gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[12px] tabular text-muted">{formatDateTime(e.at)}</span>
                  <StatusBadge status={e.status} labels={CHANGE_STATUS_LABEL} tones={CHANGE_STATUS_TONE} />
                  <span className="text-[12px] tabular text-muted">{formatVersionChange(e.fromVersion, e.toVersion)}</span>
                </div>
                <p className="mt-1 text-[13px] text-foreground">{e.suggestedChange}</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  Solicitado por {users.get(e.requestedBy)?.name ?? "—"} · {e.responsible === "TUTOR_DG" ? "via Tutor DG" : "alteração manual"}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setOpen(e)}>
                Ver alterações
              </Button>
            </li>
          ))}
        </ol>
      )}
      <DiffDialog
        open={open !== null}
        onOpenChange={(v) => !v && setOpen(null)}
        title={open ? `${open.entityName} · ${formatVersionChange(open.fromVersion, open.toVersion)}` : "Alterações"}
        description={open?.suggestedChange}
        lines={open?.diff ?? []}
      />
    </Panel>
  );
}
