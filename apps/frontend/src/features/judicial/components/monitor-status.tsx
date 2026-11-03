"use client";

import { useState } from "react";
import { formatCNJ, formatEventTime } from "@/lib/formatting";
import type { JudicialMonitorDTO } from "@/server/domain/judicial/dto";

/** Situação da última busca de uma OAB, com os números de processos fora do DG Brasil. */
export function MonitorStatus({ monitor: m }: { monitor: JudicialMonitorDTO }) {
  const [open, setOpen] = useState(false);
  if (!m.lastAttemptAt) return <span className="text-muted">Ainda não buscada</span>;
  return (
    <div className="space-y-0.5">
      <span>{formatEventTime(m.lastAttemptAt)}</span>
      {m.lastError ? (
        <span className="block text-danger">Falhou: {m.lastError}</span>
      ) : (
        <span className="block text-muted">
          {m.lastFound ?? 0} publicação(ões) na janela · {m.lastMatched ?? 0} de processos do DG Brasil
        </span>
      )}
      {m.unmatchedCnjs.length > 0 && (
        <div>
          <button type="button" className="text-[12px] font-medium text-navy hover:underline underline-offset-2" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {m.unmatchedCnjs.length} processo(s) com publicação que não estão no DG Brasil
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5">
              {m.unmatchedCnjs.map((c) => (
                <li key={c} className="tabular text-[12px] text-muted">
                  {formatCNJ(c)}
                </li>
              ))}
              <li className="text-[11.5px] text-subtle">Se o processo é do escritório, cadastre-o com este número para passar a recebê-lo.</li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
