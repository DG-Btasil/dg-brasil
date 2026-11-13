import { DEADLINE_STATUS_LABEL, DEADLINE_TYPE_LABEL, HEARING_MODE_LABEL } from "@/lib/constants/status";
import { formatCNJ } from "@/lib/formatting/masks";
import { csvDate, csvDateTime, type CsvColumn } from "@/server/domain/exports/csv";
import type { DeadlineDTO } from "./dto";

/** Linha da planilha de prazos: o prazo da agenda + os nomes do responsável e de quem conferiu. */
export interface DeadlineExportRow extends DeadlineDTO {
  responsibleName?: string;
  checkedByName?: string;
}

/** De onde o prazo veio: digitado por uma pessoa, lançado por agente ou pela integração judicial. */
export const DEADLINE_SOURCE_LABEL: Record<DeadlineDTO["source"], string> = {
  MANUAL: "Pessoa",
  AGENT: "Agente",
  JUDICIAL_INTEGRATION: "Integração judicial",
};

/** Prazo com hora marcada (audiência). Prazo comum vence no fim do dia (23:59) e sai sem hora. */
const dueTime = (d: DeadlineDTO) => (d.dueTimeLocal && d.dueTimeLocal !== "23:59" ? d.dueTimeLocal : "");
const hearing = (d: DeadlineDTO) => d.type === "HEARING";

/**
 * Colunas da planilha de prazos (agenda). "Vencido" é a situação derivada do
 * banco (em aberto com a data no passado), como na tela. O número CNJ vai com
 * máscara (sem ela o Excel estraga os 20 dígitos).
 */
export const DEADLINE_EXPORT_COLUMNS: readonly CsvColumn<DeadlineExportRow>[] = [
  { header: "Vencimento", value: (d) => csvDate(d.dueDateLocal) },
  { header: "Hora", value: dueTime },
  { header: "Prazo", value: (d) => d.title },
  { header: "Tipo", value: (d) => DEADLINE_TYPE_LABEL[d.type] },
  { header: "Situação", value: (d) => (d.effectiveStatus === "OVERDUE" ? "Vencido" : DEADLINE_STATUS_LABEL[d.status]) },
  { header: "Cliente", value: (d) => d.clientName },
  { header: "Número CNJ", value: (d) => (d.processCnj ? formatCNJ(d.processCnj) : "") },
  { header: "Processo", value: (d) => d.processTitle },
  { header: "Caso", value: (d) => d.caseTitle },
  { header: "Responsável", value: (d) => d.responsibleName },
  { header: "Origem", value: (d) => DEADLINE_SOURCE_LABEL[d.source] },
  { header: "Conferido por", value: (d) => d.checkedByName },
  { header: "Conferido em", value: (d) => csvDateTime(d.checkedAt) },
  { header: "Modalidade da audiência", value: (d) => (hearing(d) && d.hearingMode ? HEARING_MODE_LABEL[d.hearingMode] : "") },
  { header: "Local da audiência", value: (d) => (hearing(d) ? d.hearingLocation : "") },
  { header: "Link da audiência", value: (d) => (hearing(d) ? d.hearingLink : "") },
  { header: "Descrição", value: (d) => d.description },
  { header: "Cumprido em", value: (d) => csvDateTime(d.completedAt) },
  { header: "Motivo da situação", value: (d) => (d.status === "OPEN" ? "" : d.statusReason) },
];
