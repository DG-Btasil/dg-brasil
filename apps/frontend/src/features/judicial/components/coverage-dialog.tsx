"use client";

import { useEffect, useState } from "react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { formatDate, formatEventTime } from "@/lib/formatting";
import { getJudicialCoverageAction } from "@/server/domain/judicial/actions";
import type { CoverageDayDTO, JudicialMonitorDTO } from "@/server/domain/judicial/dto";

/**
 * Prova de diligência de uma OAB: dia a dia (disponibilização no DJEN), se a
 * busca conferiu e quantas publicações havia. "Assentado" = conferido de novo
 * dois dias depois (o DJEN libera parte das publicações com atraso).
 */
export function CoverageDialog({ monitor, onClose }: { monitor: JudicialMonitorDTO; onClose: () => void }) {
  const [data, setData] = useState<ActionResult<CoverageDayDTO[]> | null>(null);

  useEffect(() => {
    let alive = true;
    callAction(() => getJudicialCoverageAction({ oabNumber: monitor.oabNumber, oabState: monitor.oabState })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [monitor.oabNumber, monitor.oabState]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} size="lg" title={`Cobertura da OAB ${monitor.oabState} ${monitor.oabNumber}`} description="Últimos 15 dias, por data de disponibilização no DJEN.">
      {!data ? (
        <SkeletonRows rows={5} />
      ) : !data.ok ? (
        <ActionErrorState error={data} title="Não foi possível ler a cobertura." />
      ) : (
        <Table caption="Cobertura dia a dia">
          <THead>
            <tr>
              <Th>Dia</Th>
              <Th>Situação</Th>
              <Th>Publicações</Th>
              <Th>Última conferência</Th>
            </tr>
          </THead>
          <TBody>
            {[...data.data].reverse().map((d) => (
              <Tr key={d.day}>
                <Td className="tabular">{formatDate(d.day)}</Td>
                <Td>
                  {d.checked ? (
                    <Badge tone={d.settled ? "success" : "info"}>{d.settled ? "Conferido e assentado" : "Conferido (pode chegar mais)"}</Badge>
                  ) : (
                    <Badge tone={d.lastError ? "danger" : "neutral"}>{d.lastError ? "Falhou" : "Não conferido"}</Badge>
                  )}
                  {d.lastError && <span className="mt-0.5 block text-[11.5px] text-danger">{d.lastError}</span>}
                </Td>
                <Td className="tabular">{d.found ?? "—"}</Td>
                <Td className="text-[12.5px]">{d.lastOkAt ? formatEventTime(d.lastOkAt) : "—"}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </Dialog>
  );
}
