import { formatEventTime } from "@/lib/formatting";
import type { JudicialMonitorDTO } from "@/server/domain/judicial/dto";

/**
 * Situação da última busca de uma OAB. Das publicações de processos que não
 * estão no DG Brasil, só a contagem: nada é guardado, nem o número.
 */
export function MonitorStatus({ monitor: m }: { monitor: JudicialMonitorDTO }) {
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
    </div>
  );
}
