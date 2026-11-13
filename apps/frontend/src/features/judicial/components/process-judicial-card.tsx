"use client";

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Satellite } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatEventTime } from "@/lib/formatting";
import { getProcessJudicialStatusAction, setProcessJudicialSyncAction, syncJudicialNowAction } from "@/server/domain/judicial/actions";
import type { ProcessJudicialStatusDTO } from "@/server/domain/judicial/dto";
import { useToast } from "@/store/ui-store";
import { runSummary } from "../labels";

/**
 * Acompanhamento automático do processo (043): com CNJ cadastrado, o processo
 * recebe as publicações do DJEN e os andamentos do DataJud. Equipe: buscar
 * agora e pausar. Parceiro: só a situação.
 */
export function ProcessJudicialCard({ processId }: { processId: string }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [data, setData] = useState<ActionResult<ProcessJudicialStatusDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<"sync" | "toggle" | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => getProcessJudicialStatusAction({ processId })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [processId, version]);

  if (!data?.ok) return null;
  const s = data.data;

  async function syncNow() {
    if (busy) return;
    setBusy("sync");
    const r = await callAction(() => syncJudicialNowAction({ processId }));
    setBusy(null);
    if (!r.ok) return failed(r, "A busca não pôde ser feita.");
    if (r.data.busy) toast({ tone: "info", title: "Já existe uma busca em andamento", description: "Tente de novo em alguns minutos." });
    else toast({ tone: r.data.status === "COMPLETED" ? "success" : "warning", title: "Busca no DataJud concluída", description: runSummary(r.data.stats) });
    reload();
  }

  async function toggle() {
    if (busy) return;
    setBusy("toggle");
    const enabled = !s.syncEnabled;
    const r = await callAction(() => setProcessJudicialSyncAction({ processId, enabled }));
    setBusy(null);
    if (!r.ok) return failed(r, "Não foi possível alterar o acompanhamento.");
    toast(
      enabled
        ? { tone: "success", title: "Acompanhamento retomado", description: "O processo volta a receber os andamentos do DataJud." }
        : { tone: "success", title: "Acompanhamento pausado", description: "Os andamentos do DataJud deixam de ser buscados. As publicações do DJEN continuam chegando pelas OABs." },
    );
    reload();
  }

  return (
    <Panel>
      <PanelHeader
        title="Acompanhamento automático"
        description="Publicações do DJEN (pelas OABs acompanhadas) e andamentos do DataJud, pelo número CNJ."
        actions={
          s.tracked ? <Badge tone="success" dot>Ativo</Badge> : s.hasCnj ? <Badge tone="neutral">Pausado</Badge> : <Badge tone="neutral">Sem número CNJ</Badge>
        }
      />
      <PanelBody className="space-y-2 text-[13px]">
        {!s.hasCnj ? (
          <p className="text-muted">Cadastre o número CNJ (ao protocolar) para o processo passar a receber as atualizações sozinho.</p>
        ) : (
          <>
            <p className="text-muted">
              DataJud: {s.lastSyncedAt ? `lido em ${formatEventTime(s.lastSyncedAt)}` : "ainda não lido"}
              {s.courtAlias ? ` · índice ${s.courtAlias.toUpperCase()}` : ""}. A cópia pública do DataJud atrasa de 1 a 3 semanas; as intimações chegam antes, pelo DJEN.
            </p>
            {s.publications && (
              <p className="text-muted">
                Publicações: {s.publications.total} capturada(s){s.publications.open ? `, ${s.publications.open} a tratar` : ""}.
              </p>
            )}
            {s.lastError && <Callout tone="warning">{s.lastError}</Callout>}
            {s.canManage && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" icon={<RefreshCw className="size-3.5" aria-hidden />} loading={busy === "sync"} disabled={!s.syncEnabled || busy !== null} onClick={syncNow}>
                  Buscar andamentos agora
                </Button>
                {busy === "sync" && <span className="self-center text-[12px] text-muted">O CNJ pode levar até 2 minutos para responder.</span>}
                <Button size="sm" variant="ghost" icon={s.syncEnabled ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />} loading={busy === "toggle"} disabled={busy !== null} onClick={toggle}>
                  {s.syncEnabled ? "Pausar acompanhamento" : "Retomar acompanhamento"}
                </Button>
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

export const ProcessJudicialIcon = Satellite;
