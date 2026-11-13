import { PROCESS_ORIGIN_LABEL, PROCESS_PHASE_LABEL, PROCESS_STATUS_LABEL } from "@/lib/constants/status";
import { formatCNJ } from "@/lib/formatting/masks";
import { csvDate, csvMoney, type CsvColumn } from "@/server/domain/exports/csv";
import type { ProcessListItem } from "./dto";

/** Linha da planilha de processos: a linha da lista + o nome do responsável. */
export interface ProcessExportRow extends ProcessListItem {
  responsibleName?: string;
}

/**
 * Colunas da planilha de processos. O número CNJ vai com máscara (sem ela o
 * Excel o trata como número e estraga os 20 dígitos). O valor da causa só
 * entra para quem pode vê-lo.
 */
export function processExportColumns(withCaseValue: boolean): CsvColumn<ProcessExportRow>[] {
  return [
    { header: "Número CNJ", value: (p) => (p.cnj ? formatCNJ(p.cnj) : "") },
    { header: "Processo", value: (p) => p.title },
    { header: "Cliente", value: (p) => p.clientName },
    { header: "Caso", value: (p) => p.caseTitle },
    { header: "Tribunal", value: (p) => p.court },
    { header: "UF", value: (p) => p.state },
    { header: "Classe", value: (p) => p.actionType },
    { header: "Situação", value: (p) => PROCESS_STATUS_LABEL[p.status] },
    { header: "Fase", value: (p) => (p.phase ? PROCESS_PHASE_LABEL[p.phase] : "") },
    { header: "Origem do cadastro", value: (p) => PROCESS_ORIGIN_LABEL[p.origin] },
    { header: "Distribuição", value: (p) => csvDate(p.distributionDate) },
    ...(withCaseValue ? [{ header: "Valor da causa", value: (p: ProcessExportRow) => csvMoney(p.caseValue) }] : []),
    { header: "Próximo prazo", value: (p) => csvDate(p.nextDeadline?.dueDateLocal) },
    { header: "Prazo", value: (p) => p.nextDeadline?.title },
    { header: "Responsável", value: (p) => p.responsibleName },
    { header: "Cadastrado em", value: (p) => csvDate(p.createdAt) },
    { header: "Atualizado em", value: (p) => csvDate(p.updatedAt) },
  ];
}
