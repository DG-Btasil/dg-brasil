import type { Role } from "@/lib/permissions";
import type { UserStatus } from "@/lib/constants/status";
import type { ID, ISODateTime, OfficeScoped } from "./common";

export type { Role, Permission } from "@/lib/permissions";

export interface User extends OfficeScoped {
  name: string;
  /** Forma de tratamento usada na interface, ex.: "Dra. Barbara". */
  displayName: string;
  email: string;
  role: Role;
  title: string;
  oab?: string;
  status: UserStatus;
  hasCompletedTour: boolean;
  lastAccessAt?: ISODateTime;
  createdAt: ISODateTime;
  /**
   * Presente somente em usuários de escritório parceiro (PARTNER_ADMIN /
   * PARTNER_USER). Define o escopo de dados do usuário. Na API, virá da
   * sessão — nunca de um parâmetro enviado pelo cliente.
   */
  partnerOfficeId?: ID;
}
