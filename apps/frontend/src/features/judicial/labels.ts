import { now } from "@/lib/clock";
import type { Tone } from "@/lib/constants/status";
import { pluralize } from "@/lib/formatting";
import type { JudicialRunDTO, TriageStatus } from "@/server/domain/judicial/dto";

/** Rótulos da integração judicial (043). */

/** Tempo de espera por extenso: "25 minutos", "3 horas", "2 dias" (para "há ..."). */
export function waitingFor(since: string, reference: Date = now()): string {
  const minutes = Math.max(1, Math.floor((reference.getTime() - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return pluralize(minutes, "minuto", "minutos");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return pluralize(hours, "hora", "horas");
  return pluralize(Math.floor(hours / 24), "dia", "dias");
}

/** Por que o agente de prazos não tem como responder agora (nulo = tem como). */
export function agentBlocker(rt: { executionEnabled: boolean; executorOnline: boolean } | undefined): string | null {
  if (!rt) return null;
  if (!rt.executionEnabled) return "A execução dos agentes está desligada.";
  if (!rt.executorOnline) return "O computador do escritório não está conectado.";
  return null;
}

/**
 * Alerta da captura do DJEN (062): atrasada (para quem vê a integração) ou, só
 * para quem configura, agendador sem configuração. Nulo = nada a avisar.
 */
export function captureNotice(
  capture: { late: boolean; title?: string; message?: string; configProblem?: string } | undefined,
  canManage: boolean,
): { tone: "danger" | "warning"; title: string; message: string } | null {
  if (!capture) return null;
  if (capture.late) {
    return {
      tone: "danger",
      title: capture.title ?? "A busca de publicações está atrasada",
      message: capture.message ?? "Há OAB sem busca concluída hoje. Pode haver publicação nova sem prazo.",
    };
  }
  if (canManage && capture.configProblem) {
    return {
      tone: "warning",
      title: "O agendador da busca de publicações está sem configuração",
      message: `Só a busca das 06:30 está rodando, e nela pode não caber tudo. Avise quem cuida do sistema (${capture.configProblem}).`,
    };
  }
  return null;
}

/** Texto dos dias do calendário de prazos: o que cadastrar e o que NÃO cadastrar (062). */
export const CALENDAR_HELP =
  "A contagem já pula fins de semana, feriados nacionais, a Sexta-feira Santa e o recesso de 20/12 a 20/01 (art. 220 do CPC). " +
  "Cadastre aqui só o dia sem prazo que vale para o TRIBUNAL INTEIRO (ou para todos os tribunais): feriado estadual, suspensão por ato do tribunal. " +
  "Feriado de uma cidade só não entra: ele adiaria o prazo dos processos das outras cidades do mesmo tribunal. " +
  "Dia que falta aqui faz a data sair antes da real. Dia cadastrado a mais, ou no tribunal errado, faz a data sair DEPOIS da real: confira antes de salvar.";

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
  if (stats.djenBackfillWindows) parts.push(`${stats.djenBackfillWindows} período(s) antigo(s) relido(s)`);
  if (stats.djenBackfillLeftForNextRun) parts.push(`${stats.djenBackfillLeftForNextRun} OAB(s) com dias antigos por ler`);
  if (stats.djenErrors || stats.datajudErrors) parts.push(`${(stats.djenErrors ?? 0) + (stats.datajudErrors ?? 0)} falha(s)`);
  return parts.join(" · ") || "Nada novo";
}
