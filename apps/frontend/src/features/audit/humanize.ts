import type { AuditEventDTO } from "@/server/domain/audit/dto";

/**
 * Trilha de auditoria do BANCO → frases para pessoas. Puro e testado. As
 * ações ficam no vocabulário do banco (triggers da 014 e operações
 * posteriores); ação desconhecida aparece com um rótulo genérico, nunca some.
 * Só usa a metadata sanitizada do servidor (ids, status, nomes de campo,
 * contagens) — nenhum texto livre.
 */

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  CLIENT_CREATED: "Cliente cadastrado",
  CLIENT_UPDATED: "Cadastro do cliente atualizado",
  CLIENT_INTERNAL_DETAILS_UPDATED: "Dados internos do cliente atualizados",
  CLIENT_INACTIVATED: "Cliente inativado",
  CLIENT_RESTORED: "Cliente reativado",
  CLIENT_DELETED: "Cliente excluído",
  CLIENT_ORIGIN_CHANGED: "Origem do cliente alterada",
  CLIENT_PARTNER_LINKED: "Cliente vinculado a parceiro",
  CLIENT_RELATIONSHIP_CREATED: "Relacionamento com escritório criado",
  CLIENT_RELATIONSHIP_CHANGED: "Relacionamento com escritório alterado",
  CLIENT_DUPLICATE_DETECTED: "Tentativa de cadastro duplicado",
  COMPANY_PEOPLE_REPLACED: "Representantes e sócios atualizados",
  CASE_CREATED: "Caso criado",
  CASE_UPDATED: "Caso atualizado",
  CASE_SUBMITTED: "Caso enviado para análise",
  CASE_STATUS_CHANGED: "Situação do caso alterada",
  CASE_ACCEPTED: "Caso aceito",
  CASE_REJECTED: "Caso não aceito",
  CASE_LAWYER_ASSIGNED: "Advogado responsável definido",
  CASE_ORIGIN_CHANGED: "Origem do caso alterada",
  CASE_PARTNER_CHANGED: "Parceiro do caso alterado",
  CASE_INTERNAL_DETAILS_UPDATED: "Observações internas do caso atualizadas",
  CASE_DELETED: "Caso excluído",
  CASE_RESTORED: "Caso restaurado",
  PROCESS_CREATED: "Processo cadastrado",
  PROCESS_UPDATED: "Processo atualizado",
  PROCESS_INTERNAL_DETAILS_UPDATED: "Dados internos do processo atualizados",
  PROCESS_DELETED: "Processo excluído",
  PROCESS_EVENT_CREATED: "Andamento registrado",
  PROCESS_EVENT_UPDATED: "Andamento atualizado",
  DEADLINE_CREATED: "Prazo criado",
  DEADLINE_UPDATED: "Prazo atualizado",
  DEADLINE_COMPLETED: "Prazo cumprido",
  DEADLINE_STATUS_CHANGED: "Situação do prazo alterada",
  DOCUMENT_CREATED: "Documento criado",
  DOCUMENT_UPDATED: "Documento atualizado",
  DOCUMENT_UPLOADED: "Arquivo enviado",
  DOCUMENT_VERSION_CREATED: "Nova versão de documento",
  DOCUMENT_DOWNLOADED: "Documento baixado",
  DOCUMENT_VERIFIED: "Arquivo verificado",
  DOCUMENT_VERIFICATION_FAILED: "Divergência registrada no arquivo",
  DOCUMENT_VISIBILITY_CHANGED: "Visibilidade do documento alterada",
  DOCUMENT_LINKED_TO_CASE: "Documento vinculado ao caso",
  DOCUMENT_LINKED_TO_PROCESS: "Documento vinculado ao processo",
  DOCUMENT_REQUIREMENT_CREATED: "Pendência documental criada",
  DOCUMENT_REQUIREMENT_STATUS_CHANGED: "Pendência documental atualizada",
  ANALYSIS_STARTED: "Análise jurídica iniciada",
  ANALYSIS_STATUS_CHANGED: "Situação da análise alterada",
  ANALYSIS_UPDATED: "Análise atualizada",
  REVIEW_CREATED: "Revisão criada",
  REVIEW_UPDATED: "Revisão atualizada",
  REVIEW_APPROVED: "Revisão aprovada",
  REVIEW_REJECTED: "Revisão rejeitada",
  REVIEW_CHANGES_REQUESTED: "Alterações solicitadas na revisão",
  REVIEW_REOPENED: "Revisão reaberta",
  AGENT_RUN_REQUESTED: "Execução de agente pedida",
  AGENT_PROPOSAL_CREATED: "Proposta do agente criada",
  PARTNER_REQUEST_CREATED: "Solicitação ao parceiro criada",
  PARTNERSHIP_AGREEMENT_CREATED: "Parceria do caso registrada",
  PARTNERSHIP_AGREEMENT_CANCELLED: "Parceria do caso cancelada",
  PARTNER_SETTINGS_CREATED: "Divisão do parceiro registrada",
  PARTNER_SETTINGS_UPDATED: "Divisão do parceiro atualizada",
  PARTNER_SHARE_CHANGED: "Divisão padrão do parceiro alterada",
  PARTNER_REVENUE_ALLOCATED: "Divisão de recebimento gerada",
  PARTNER_TRANSFER_REGISTERED: "Repasse registrado",
  PARTNER_TRANSFER_UPDATED: "Repasse atualizado",
  PARTNER_TRANSFER_PAID: "Repasse pago",
  PARTNER_TRANSFER_CANCELLED: "Repasse cancelado",
  PARTNER_TRANSFER_ITEM_ADDED: "Item de repasse registrado",
  FINANCIAL_AGREEMENT_CREATED: "Contrato de honorários criado",
  FINANCIAL_AGREEMENT_UPDATED: "Contrato de honorários atualizado",
  PAYMENT_REGISTERED: "Obrigação registrada",
  PAYMENT_UPDATED: "Obrigação atualizada",
  PAYMENT_DUE_DATE_CHANGED: "Vencimento alterado",
  PAYMENT_CANCELLED: "Obrigação cancelada",
  PAYMENT_RECEIPT_RECORDED: "Recebimento registrado",
  PAYMENT_RECEIPT_ADJUSTED: "Ajuste registrado",
  PAYMENT_RECEIPT_REVERSED: "Estorno registrado",
  ORGANIZATION_CREATED: "Escritório cadastrado",
  ORGANIZATION_UPDATED: "Escritório atualizado",
  ORGANIZATION_STATUS_CHANGED: "Situação do escritório alterada",
  PROFILE_CREATED: "Usuário criado",
  PROFILE_UPDATED: "Perfil atualizado",
  USER_INVITED: "Usuário convidado",
  USER_DEACTIVATED: "Usuário desativado",
  USER_REACTIVATED: "Usuário reativado",
  ROLE_CHANGED: "Papel alterado",
  MEMBERSHIP_CREATED: "Acesso concedido",
  MEMBERSHIP_STATUS_CHANGED: "Situação do acesso alterada",
  INVITATION_ACCEPTED: "Convite aceito",
  INVITATION_REVOKED: "Convite revogado",
  INVITATION_UPDATED: "Convite atualizado",
  MFA_RESET_REQUESTED: "Redefinição de MFA pedida",
  MFA_RESET_COMPLETED: "MFA redefinido",
  LEGAL_TERMS_ACCEPTED: "Termos aceitos",
  AGENT_CREATED: "Agente criado",
  AGENT_UPDATED: "Agente atualizado",
  AGENT_BINDING_CHANGED: "Vínculos do agente alterados",
  SKILL_CREATED: "Skill criada",
  SKILL_UPDATED: "Skill atualizada",
  SKILL_BINDING_CHANGED: "Vínculos da skill alterados",
  THESIS_CREATED: "Tese criada",
  THESIS_UPDATED: "Tese atualizada",
  THESIS_BINDING_CHANGED: "Vínculos da tese alterados",
  REFERENCE_CREATED: "Referência criada",
  REFERENCE_UPDATED: "Referência atualizada",
  INTEGRATION_CREATED: "Integração criada",
  INTEGRATION_UPDATED: "Integração atualizada",
  JUDICIAL_SOURCE_CONFIGURED: "Fonte judicial configurada",
  IMPORT_JOB_CREATED: "Importação iniciada",
  IMPORT_CONFLICT_RESOLVED: "Conflito de importação resolvido",
};

/** Ações com prefixo dinâmico (ex.: AGENT_RUN_COMPLETED, IMPORT_JOB_FINISHED). */
const PREFIX_LABEL: [string, string][] = [
  ["AGENT_RUN_", "Execução de agente atualizada"],
  ["AGENT_PROPOSAL_", "Proposta do agente atualizada"],
  ["PARTNER_REQUEST_", "Solicitação ao parceiro atualizada"],
  ["IMPORT_JOB_", "Importação atualizada"],
];

export const ACTOR_TYPE_LABEL: Record<AuditEventDTO["actorType"], string> = { USER: "Pessoa", AGENT: "Agente", SYSTEM: "Sistema" };

/** Rótulo da ação; desconhecida vira texto legível ("ALGO_NOVO" → "Algo novo"). */
export function actionLabel(action: string): string {
  if (AUDIT_ACTION_LABEL[action]) return AUDIT_ACTION_LABEL[action];
  const prefixed = PREFIX_LABEL.find(([p]) => action.startsWith(p));
  if (prefixed) return prefixed[1];
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const STATUS_WORD: Record<string, string> = {
  DRAFT: "rascunho",
  SUBMITTED: "enviado",
  WAITING_DOCUMENTS: "aguardando documentos",
  READY_FOR_ANALYSIS: "pronto para análise",
  ANALYZING: "em análise",
  WAITING_REVIEW: "aguardando revisão",
  ACCEPTED: "aceito",
  REJECTED: "não aceito",
  IN_PROGRESS: "em andamento",
  CLOSED: "encerrado",
  ARCHIVED: "arquivado",
  PENDING: "pendente",
  QUEUED: "na fila",
  RUNNING: "executando",
  COMPLETED: "concluído",
  FAILED: "falhou",
  CANCELLED: "cancelado",
  ACTIVE: "ativo",
  INACTIVE: "inativo",
  SUSPENDED: "suspenso",
  OPEN: "aberto",
  ANSWERED: "respondido",
  RESOLVED: "resolvido",
  REQUESTED: "solicitado",
  RECEIVED: "recebido",
  APPROVED: "aprovado",
  MISSING: "não solicitado",
  PAID: "pago",
  REOPENED: "reaberto",
  CHANGES_REQUESTED: "alterações solicitadas",
};

const status = (v: unknown) => (typeof v === "string" ? (STATUS_WORD[v] ?? v.toLowerCase()) : undefined);

/** Detalhe curto e seguro: "de enviado para aceito", "campos: title, summary", contagens. */
export function eventDetail(event: Pick<AuditEventDTO, "metadata" | "metadataOmitted">): string | undefined {
  const m = event.metadata;
  const parts: string[] = [];
  const from = status(m.from);
  const to = status(m.to);
  if (to && from && from !== to) parts.push(`de ${from} para ${to}`);
  else if (to) parts.push(to);
  const fields = Array.isArray(m.fields) ? m.fields.filter((f) => !["updated_at", "status"].includes(f)) : [];
  if (fields.length) parts.push(`${fields.length === 1 ? "campo" : "campos"}: ${fields.join(", ")}`);
  return parts.length ? parts.join(" · ") : undefined;
}
