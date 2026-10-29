/**
 * Execução dos agentes, do lado da tela. Quem executa é o Claude Code do
 * computador do escritório (migration 040): o DG Brasil só diz QUAL agente
 * local faz o trabalho e o que entregar. Modelo, esforço e limites ficam na
 * configuração do próprio Claude Code.
 */

/** Nome do agente no Claude Code (o mesmo padrão do banco, 040). */
export const LOCAL_AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Referência com arquivo. */
export const REFERENCE_FILE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
};
export const REFERENCE_FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Mensagem amigável por código de erro da execução. Nunca o erro bruto. */
export const RUN_ERROR_LABEL: Record<string, string> = {
  // computador do escritório (040)
  LEASE_EXPIRED: "O computador do escritório parou de responder; o trabalho voltou para a fila.",
  EXECUTOR_UNAVAILABLE: "O computador do escritório parou de responder em 3 tentativas.",
  EXECUTOR_REVOKED: "O acesso do computador foi revogado; o trabalho voltou para a fila.",
  NO_ANALYSIS_RESULT: "O trabalho terminou sem entregar o resultado da análise.",
  DOCUMENT_CHECKSUM_MISMATCH: "Um documento baixado não conferia com a versão registrada.",
  DOCUMENT_UNREADABLE: "Um documento do caso não pôde ser lido.",
  AGENT_NOT_FOUND: "O agente indicado não existe no Claude Code do escritório.",
  INTERRUPTED: "A sessão do Claude Code foi encerrada antes do fim.",
  // comuns
  CANCELLED: "Interrompida a pedido.",
  CANCELLED_BY_USER: "Interrompida a pedido.",
  INVALID_OUTPUT: "O agente não entregou o resultado no formato exigido.",
  TOOL_ERROR: "Uma ferramenta falhou durante a execução.",
  MISSING_INPUT: "Faltavam dados ou documentos para executar.",
  CONFIGURATION_ERROR: "Configuração do agente inválida. Avise o administrador.",
  INTERNAL_ERROR: "Erro interno.",
  PARTIAL_OUTPUT: "Falhou depois de entregar parte do resultado: confira em Revisões.",
  MAX_ATTEMPTS: "Esgotou as tentativas.",
  AGENT_ERROR: "Falha temporária; o trabalho voltou para a fila.",
  // execuções antigas (Claude API, Etapa 5)
  PROVIDER_UNAVAILABLE: "O provedor de IA estava indisponível.",
  PROVIDER_RATE_LIMITED: "O provedor de IA limitou o uso.",
  EXECUTION_TIMEOUT: "A execução passou do tempo máximo.",
  BUDGET_EXCEEDED: "A execução atingiu o limite de custo, passos ou chamadas.",
  PROVIDER_REFUSED: "O provedor de IA recusou a tarefa.",
};

export function runErrorLabel(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  return RUN_ERROR_LABEL[code] ?? "A execução falhou.";
}
