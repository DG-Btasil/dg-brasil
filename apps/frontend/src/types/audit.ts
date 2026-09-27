import type { ActorRef, ID, ISODateTime, OfficeScoped } from "./common";

export const AUDIT_ACTIONS = [
  "OFFICE_CREATED",
  "OFFICE_UPDATED",
  "ONBOARDING_COMPLETED",
  "USER_INVITED",
  "USER_ROLE_CHANGED",
  "CLIENT_CREATED",
  "CLIENT_UPDATED",
  "DOCUMENT_ADDED",
  "DOCUMENT_STATUS_CHANGED",
  "ANALYSIS_STARTED",
  "ANALYSIS_UPDATED",
  "ANALYSIS_INTERRUPTED",
  "PROCESS_CREATED",
  "PROCESS_UPDATED",
  "DEADLINE_CREATED",
  "DEADLINE_COMPLETED",
  "REVIEW_CREATED",
  "REVIEW_APPROVED",
  "REVIEW_REJECTED",
  "REVIEW_CHANGES_REQUESTED",
  "FEE_MODEL_CREATED",
  "FEE_MODEL_UPDATED",
  "AGREEMENT_CREATED",
  "PAYMENT_REGISTERED",
  "SKILL_UPDATED",
  "AGENT_UPDATED",
  "INTEGRATION_UPDATED",
  "DEMO_RESET",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  OFFICE_CREATED: "Escritório criado",
  OFFICE_UPDATED: "Escritório atualizado",
  ONBOARDING_COMPLETED: "Implantação concluída",
  USER_INVITED: "Usuário convidado",
  USER_ROLE_CHANGED: "Papel alterado",
  CLIENT_CREATED: "Cliente criado",
  CLIENT_UPDATED: "Cliente editado",
  DOCUMENT_ADDED: "Documento adicionado",
  DOCUMENT_STATUS_CHANGED: "Status de documento alterado",
  ANALYSIS_STARTED: "Análise iniciada",
  ANALYSIS_UPDATED: "Análise atualizada",
  ANALYSIS_INTERRUPTED: "Análise interrompida",
  PROCESS_CREATED: "Processo criado",
  PROCESS_UPDATED: "Processo atualizado",
  DEADLINE_CREATED: "Prazo criado",
  DEADLINE_COMPLETED: "Prazo cumprido",
  REVIEW_CREATED: "Revisão criada",
  REVIEW_APPROVED: "Revisão aprovada",
  REVIEW_REJECTED: "Revisão rejeitada",
  REVIEW_CHANGES_REQUESTED: "Alteração solicitada",
  FEE_MODEL_CREATED: "Modelo de honorários criado",
  FEE_MODEL_UPDATED: "Modelo de honorários alterado",
  AGREEMENT_CREATED: "Contrato de honorários criado",
  PAYMENT_REGISTERED: "Pagamento registrado",
  SKILL_UPDATED: "Skill modificada",
  AGENT_UPDATED: "Agente configurado",
  INTEGRATION_UPDATED: "Integração atualizada",
  DEMO_RESET: "Dados de demonstração restaurados",
};

export interface AuditEvent extends OfficeScoped {
  at: ISODateTime;
  actor: ActorRef;
  action: AuditAction;
  entityType: string;
  entityId: ID;
  description: string;
}
