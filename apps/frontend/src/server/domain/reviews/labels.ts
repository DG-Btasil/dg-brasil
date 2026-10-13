/** Rótulos de leitura da revisão (puro: usado no servidor e na tela). */

/** Tipo da proposta do agente (CHECK de agent_proposals.proposal_type, 012). */
export const PROPOSAL_TYPE_LABEL: Record<string, string> = {
  CREATE_DEADLINE: "Proposta de prazo",
  REQUEST_DOCUMENT: "Pedido de documento",
  UPDATE_CASE: "Atualização do caso",
  CREATE_PROCESS: "Cadastro de processo",
  UPDATE_SKILL: "Alteração de skill",
  UPDATE_AGENT: "Alteração de agente",
  OTHER: "Proposta do agente",
};
