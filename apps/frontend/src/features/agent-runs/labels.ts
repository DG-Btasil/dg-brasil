/**
 * Rótulos dos códigos técnicos de uma execução de agente. Código que a tela
 * não conhece sai com um texto neutro em português, nunca o código cru.
 */

/** Tipo do pedido (`agent_runs.operation`). */
export const AGENT_RUN_OPERATION_LABEL: Record<string, string> = {
  EXECUTE: "Execução",
  PROCESS_TASK: "Tarefa do processo",
};
export function agentRunOperationLabel(operation: string | undefined): string {
  return (operation && AGENT_RUN_OPERATION_LABEL[operation]) || "Pedido ao agente";
}

/** Quem executou (dados técnicos, só Administrador). */
export const AGENT_RUN_PROVIDER_LABEL: Record<string, string> = {
  CLAUDE_CODE: "Claude Code",
  ANTHROPIC: "Anthropic (API)",
};
export function agentRunProviderLabel(provider: string | undefined): string {
  return (provider && AGENT_RUN_PROVIDER_LABEL[provider]) || "Outro provedor";
}

/** Tipo de registro da linha do tempo (`agent_run_events.kind`), usado quando o registro vem sem mensagem. */
export const AGENT_RUN_EVENT_KIND_LABEL: Record<string, string> = {
  STATUS: "Situação atualizada",
  PROGRESS: "Andamento informado",
  DOCUMENT_OPENED: "Documento aberto",
  OUTPUT: "Entrega registrada",
  ERROR: "Erro registrado",
  LEASE: "Trabalho reservado pelo computador do escritório",
};
export function agentRunEventKindLabel(kind: string | undefined): string {
  return (kind && AGENT_RUN_EVENT_KIND_LABEL[kind]) || "Registro da execução";
}
