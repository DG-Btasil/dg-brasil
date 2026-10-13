import type { ActorType, ID, ISODateTime } from "@/types";

/**
 * DTOs da leitura de auditoria (só ADMIN). `action` e `entityType` ficam no
 * vocabulário do BANCO (ex.: PARTNER_SHARE_CHANGED, organizations): a trilha
 * é a do banco, não a dos mocks (AUDIT_ACTIONS do front).
 *
 * Fora do DTO, de propósito: `ip_address` e `user_agent`. São dado pessoal
 * (LGPD) e não servem à leitura da trilha (quem fez o quê, quando, em qual
 * registro). Perícia de acesso, se um dia necessária, deve ser operação
 * própria, com finalidade registrada — não um campo a mais na listagem.
 */

/** Valores que a metadata sanitizada pode ter. Nada de texto livre. */
export type AuditMetadataValue = string | number | boolean | null | string[] | Record<string, number | null>;
export type AuditMetadata = Record<string, AuditMetadataValue>;

export interface AuditEventDTO {
  id: ID;
  at: ISODateTime;
  actorType: ActorType;
  actorUserId?: ID;
  /** Nome do perfil do ator (equipe ou parceiro), quando há usuário. */
  actorName?: string;
  actorOrganizationId?: ID;
  agentRunId?: ID;
  action: string;
  entityType: string;
  entityId?: ID;
  /** Correlation ID da requisição (UUID, sem PII). */
  requestId?: string;
  /** Só chaves e valores da whitelist (IDs, status, nomes de campo, valores numéricos). */
  metadata: AuditMetadata;
  /** Havia chaves fora da whitelist (ex.: motivo em texto livre) — omitidas. */
  metadataOmitted: boolean;
}

export interface PersonalDataAccessEventDTO {
  id: ID;
  at: ISODateTime;
  actorType: ActorType;
  actorUserId?: ID;
  actorName?: string;
  organizationId?: ID;
  agentRunId?: ID;
  clientId: ID;
  resourceType: string;
  resourceId?: ID;
  action: string;
  /**
   * Finalidade declarada por quem acessou (até 500 caracteres, escrita pelo
   * backend). Vai para o ADMIN porque é o que justifica o acesso na revisão LGPD.
   */
  purpose?: string;
  requestId?: string;
}
