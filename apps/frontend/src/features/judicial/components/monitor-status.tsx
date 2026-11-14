import { Dot } from "@/components/ui/badge";
import { now } from "@/lib/clock";
import { formatEventTime } from "@/lib/formatting";
import type { JudicialMonitorDTO } from "@/server/domain/judicial/dto";
import { djenMonitorDot } from "../capture-dots";

/** O que a tela sabe da captura do dia (Integrações). No portal do parceiro não vem. */
export interface MonitorCaptureContext {
  djenEnabled?: boolean;
  captureApplies?: boolean;
}

/**
 * Situação da última busca de uma OAB. Das publicações de processos que não
 * estão no DG Brasil, só a contagem: nada é guardado, nem o número. A bolinha
 * (074) diz se a OAB foi conferida hoje.
 */
export function MonitorStatus({ monitor: m, context }: { monitor: JudicialMonitorDTO; context?: MonitorCaptureContext }) {
  const dot = djenMonitorDot({ active: m.active, lastSuccessAt: m.lastSuccessAt, now: now(), ...context });
  const mark = <Dot tone={dot.tone} label={dot.label} />;
  if (!m.lastAttemptAt)
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        {mark}
        Ainda não buscada
      </span>
    );
  return (
    <div className="space-y-0.5">
      <span className="inline-flex items-center gap-1.5">
        {mark}
        {formatEventTime(m.lastAttemptAt)}
      </span>
      {m.lastError ? (
        <span className="block text-danger">Falhou: {m.lastError}</span>
      ) : (
        <span className="block text-muted">
          {m.lastFound ?? 0} publicação(ões) na janela · {m.lastMatched ?? 0} de processos do DG Brasil
        </span>
      )}
    </div>
  );
}
