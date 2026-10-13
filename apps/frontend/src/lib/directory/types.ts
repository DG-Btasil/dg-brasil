import type { PartnerOfficeStatus } from "@/lib/constants/status";
import type { Role } from "@/lib/permissions";
import type { ID } from "@/types";

/**
 * Diretório REAL da organização (Etapa 4.3, Fase A): quem é o escritório
 * proprietário, quem são os integrantes e quais parceiros a sessão enxerga.
 * Carregado no servidor (server/directory.ts) a partir dos services, com a
 * RLS do usuário — substitui `users`/`office`/`partnerOffices` do mock nas
 * telas já conectadas.
 */

export interface DirectoryUser {
  /** auth.users.id — o mesmo id gravado em responsible_user_id etc. */
  id: ID;
  name: string;
  displayName: string;
  role: Role;
}

export interface DirectoryOrganization {
  id: ID;
  name: string;
  status: PartnerOfficeStatus;
}

export interface OrgDirectory {
  owner: { id: ID; name: string };
  /** Integrantes ATIVOS do escritório da sessão. */
  users: DirectoryUser[];
  /**
   * Parceiros visíveis: equipe interna com `partners.view` vê todos; o
   * parceiro vê só o próprio escritório; os demais, nenhum.
   */
  partners: DirectoryOrganization[];
  /** Falso quando alguma leitura falhou (a tela continua, com menos nomes). */
  complete: boolean;
}
