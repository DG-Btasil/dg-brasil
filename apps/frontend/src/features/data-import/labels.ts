import type { Tone } from "@/lib/constants/status";
import type { ImportConflictKind, ImportJobStatus, ImportResolution, ImportRowStatus } from "@/server/domain/imports/dto";

export const JOB_STATUS_LABEL: Record<ImportJobStatus, string> = {
  UPLOADED: "Arquivo enviado",
  COLUMNS_DETECTED: "Mapear colunas",
  MAPPED: "Mapear colunas",
  VALIDATED: "Simulação pronta",
  CONFLICTS_PENDING: "Conflitos pendentes",
  CONFIRMED: "Confirmada",
  PROCESSING: "Gravando",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

export const JOB_STATUS_TONE: Record<ImportJobStatus, Tone> = {
  UPLOADED: "neutral",
  COLUMNS_DETECTED: "info",
  MAPPED: "info",
  VALIDATED: "info",
  CONFLICTS_PENDING: "warning",
  CONFIRMED: "navy",
  PROCESSING: "navy",
  COMPLETED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export const ROW_STATUS_LABEL: Record<ImportRowStatus, string> = {
  VALID: "Pronta",
  WARNING: "Com aviso",
  ERROR: "Com erro",
  IMPORTED: "Importada",
  SKIPPED: "Ignorada",
};

export const ROW_STATUS_TONE: Record<ImportRowStatus, Tone> = {
  VALID: "success",
  WARNING: "warning",
  ERROR: "danger",
  IMPORTED: "success",
  SKIPPED: "neutral",
};

export const CONFLICT_KIND_LABEL: Record<ImportConflictKind, string> = {
  CLIENT_DOCUMENT: "CPF/CNPJ já cadastrado",
  PROCESS_CNJ: "Processo (CNJ) já cadastrado",
  POSSIBLE_DUPLICATE: "Possível cliente duplicado (mesmo nome, outro documento)",
};

/** Decisões permitidas por tipo (as mesmas do banco, 042) e o texto de cada uma. */
export const CONFLICT_CHOICES: Record<ImportConflictKind, { value: ImportResolution; label: string; hint: string }[]> = {
  CLIENT_DOCUMENT: [
    { value: "UPDATE", label: "Atualizar o cadastro", hint: "Os campos preenchidos na planilha substituem os atuais; os vazios não apagam nada. Os processos da planilha são vinculados a este cliente." },
    { value: "IGNORE", label: "Manter o cadastro como está", hint: "O cliente não muda; os processos da planilha são vinculados a ele." },
  ],
  PROCESS_CNJ: [
    { value: "UPDATE", label: "Atualizar o processo", hint: "Os campos preenchidos na planilha substituem os atuais. O cliente do processo não muda e nenhum prazo é criado." },
    { value: "IGNORE", label: "Ignorar o processo da linha", hint: "O processo existente não muda." },
  ],
  POSSIBLE_DUPLICATE: [
    { value: "CREATE_NEW", label: "Criar mesmo assim", hint: "São pessoas diferentes: cria o cliente novo com este documento." },
    { value: "IGNORE", label: "Ignorar as linhas deste cliente", hint: "Nada destas linhas é gravado (nem cliente, nem processos). Corrija a planilha e importe de novo, se for o caso." },
  ],
};

export const ACTION_LABEL: Record<string, string> = {
  CREATE: "criado",
  UPDATE: "atualizado",
  KEEP: "mantido",
  LINK: "vinculado",
  SKIP: "ignorado",
};
