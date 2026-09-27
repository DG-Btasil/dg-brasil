/**
 * RBAC centralizado.
 *
 * Componentes nunca comparam papel (`role === "ADMIN"`). Eles perguntam por
 * uma permissão: `can(role, "finance.view")`, `usePermission(...)`, `<Can>`.
 * Para mudar o que um papel enxerga, altere apenas ROLE_PERMISSIONS.
 *
 * No backend futuro, a mesma matriz precisa existir no servidor: esconder
 * interface não é autorização. Aqui ela só decide o que renderizar.
 */

export const ROLES = ["ADMIN", "LAWYER", "ASSISTANT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  LAWYER: "Advogado",
  ASSISTANT: "Assistente",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Acesso completo ao escritório, inclusive Financeiro, DG Brasil e configurações administrativas.",
  LAWYER: "Clientes, processos e revisões. Não acessa Financeiro nem a Central do DG Brasil.",
  ASSISTANT: "Clientes e processos. Não acessa Revisões, Financeiro, DG Brasil nem configurações.",
};

export const PERMISSIONS = [
  "home.view",
  "clients.view",
  "clients.edit",
  "documents.manage",
  "analyses.start",
  "processes.view",
  "processes.edit",
  "processes.caseValue.view",
  "reviews.view",
  "reviews.decide",
  "finance.view",
  "finance.manage",
  "dgbrasil.view",
  "dgbrasil.manage",
  "dgbrasil.activity.view",
  "settings.view",
  "settings.office.edit",
  "settings.team.manage",
  "settings.integrations.view",
  "settings.integrations.manage",
  "settings.ai.view",
  "settings.fees.manage",
  "settings.security.view",
  "settings.billing.view",
  "settings.notifications.edit",
  "audit.view",
  "demo.tools",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL,
  LAWYER: [
    "home.view",
    "clients.view",
    "clients.edit",
    "documents.manage",
    "analyses.start",
    "processes.view",
    "processes.edit",
    "processes.caseValue.view",
    "reviews.view",
    "reviews.decide",
    "settings.view",
    "settings.integrations.view",
    "settings.notifications.edit",
    "demo.tools",
  ],
  ASSISTANT: [
    "home.view",
    "clients.view",
    "clients.edit",
    "documents.manage",
    "processes.view",
    "processes.caseValue.view",
    "demo.tools",
  ],
};

const PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(ROLE_PERMISSIONS.ADMIN),
  LAWYER: new Set(ROLE_PERMISSIONS.LAWYER),
  ASSISTANT: new Set(ROLE_PERMISSIONS.ASSISTANT),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSION_SETS[role].has(permission);
}

export function canAll(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

export function canAny(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}
