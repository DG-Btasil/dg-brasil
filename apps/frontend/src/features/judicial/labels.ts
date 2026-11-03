import type { Tone } from "@/lib/constants/status";
import type { JudicialRunDTO, TriageStatus } from "@/server/domain/judicial/dto";

/** Rótulos da integração judicial (043). */

export const TRIAGE_LABEL: Record<TriageStatus, string> = {
  PENDING: "A tratar",
  WITH_AGENT: "Com o agente",
  DONE: "Tratada",
};
export const TRIAGE_TONE: Record<TriageStatus, Tone> = { PENDING: "warning", WITH_AGENT: "info", DONE: "success" };

export const RUN_STATUS_LABEL: Record<JudicialRunDTO["status"], string> = {
  RUNNING: "Em andamento",
  COMPLETED: "Concluída",
  PARTIAL: "Concluída com falhas",
  FAILED: "Falhou",
};
export const RUN_STATUS_TONE: Record<JudicialRunDTO["status"], Tone> = { RUNNING: "info", COMPLETED: "success", PARTIAL: "warning", FAILED: "danger" };

export const RUN_SCOPE_LABEL: Record<JudicialRunDTO["scope"], string> = {
  ALL: "Publicações e andamentos",
  DATAJUD: "Andamentos (lote)",
  PROCESS: "Um processo",
};

export const DEADLINE_TYPE_OPTIONS = [
  { value: "MANIFESTATION", label: "Manifestação" },
  { value: "REPLY", label: "Réplica / impugnação" },
  { value: "APPEAL", label: "Recurso" },
  { value: "HEARING", label: "Audiência" },
  { value: "DOCUMENT_DELIVERY", label: "Entrega de documento" },
  { value: "FILING", label: "Protocolo" },
  { value: "INTERNAL", label: "Interno" },
] as const;

/** Resumo legível das contagens de uma rodada. */
export function runSummary(stats: Record<string, number> | undefined): string {
  if (!stats) return "—";
  const parts: string[] = [];
  if (stats.oabsChecked !== undefined && stats.oabs) parts.push(`${stats.oabsChecked}/${stats.oabs} OAB(s)`);
  if (stats.publicationsNew) parts.push(`${stats.publicationsNew} publicação(ões) nova(s)`);
  if (stats.publicationsOutsideDgBrasil) parts.push(`${stats.publicationsOutsideDgBrasil} fora do DG Brasil`);
  if (stats.processesRead) parts.push(`${stats.processesRead} processo(s) lido(s)`);
  if (stats.movementsNew) parts.push(`${stats.movementsNew} andamento(s) novo(s)`);
  if (stats.processesLeftForNextRun) parts.push(`${stats.processesLeftForNextRun} para o próximo lote`);
  if (stats.djenErrors || stats.datajudErrors) parts.push(`${(stats.djenErrors ?? 0) + (stats.datajudErrors ?? 0)} falha(s)`);
  return parts.join(" · ") || "Nada novo";
}
