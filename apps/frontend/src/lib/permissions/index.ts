/**
 * RBAC centralizado.
 *
 * Componentes nunca comparam papel (`role === "ADMIN"`). Eles perguntam por
 * uma permissão: `can(role, "finance.view")`, `usePermission(...)`, `<Can>`.
 * Para mudar o que um papel enxerga, altere apenas ROLE_PERMISSIONS.
 *
 * Existem dois públicos (audiences):
 * - OWNER: equipe da Bárbara Cardoso Advocacia (escritório proprietário), visão global;
 * - PARTNER: usuários de um escritório parceiro, que veem apenas os dados da
 *   própria relação com o DG Brasil. O recorte de DADOS do parceiro fica em
 *   `./partner-scope.ts`; aqui ficam apenas os papéis e as permissões.
 *
 * No backend futuro, a mesma matriz precisa existir no servidor: esconder
 * interface não é autorização. Aqui ela só decide o que renderizar.
 */

/** Papéis internos (Bárbara Cardoso Advocacia). Usados na gestão da equipe interna. */
export const ROLES = ["ADMIN", "LAWYER", "ASSISTANT"] as const;
export const INTERNAL_ROLES = ROLES;
export type InternalRole = (typeof ROLES)[number];

/**
 * Papéis de escritório parceiro. NÃO são equivalentes aos papéis internos:
 * têm matriz própria e sempre dependem de um `partnerOfficeId`.
 */
export const PARTNER_ROLES = ["PARTNER_ADMIN", "PARTNER_USER"] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number];

export const ALL_ROLES = [...ROLES, ...PARTNER_ROLES] as const;
export type Role = InternalRole | PartnerRole;

export type Audience = "OWNER" | "PARTNER";

export const ROLE_AUDIENCE: Record<Role, Audience> = {
  ADMIN: "OWNER",
  LAWYER: "OWNER",
  ASSISTANT: "OWNER",
  PARTNER_ADMIN: "PARTNER",
  PARTNER_USER: "PARTNER",
};

export function audienceOf(role: Role | null | undefined): Audience | undefined {
  return role ? ROLE_AUDIENCE[role] : undefined;
}

export function isPartnerRole(role: Role | null | undefined): role is PartnerRole {
  return audienceOf(role) === "PARTNER";
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  LAWYER: "Advogado",
  ASSISTANT: "Assistente",
  PARTNER_ADMIN: "Administrador do parceiro",
  PARTNER_USER: "Usuário do parceiro",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  ADMIN: "Acesso completo ao escritório, inclusive Financeiro, DG Brasil, Parceiros e configurações administrativas.",
  LAWYER: "Clientes, processos, revisões e parceiros. Não acessa Financeiro nem a Central do DG Brasil.",
  ASSISTANT: "Clientes e processos. Não acessa Revisões, Financeiro, DG Brasil, Parceiros nem configurações.",
  PARTNER_ADMIN:
    "Clientes, processos, documentos e pendências do próprio escritório, participação financeira da parceria e gestão dos usuários do escritório.",
  PARTNER_USER: "Clientes, processos, documentos e pendências do próprio escritório. Não acessa valores da parceria.",
};

/** Permissões do ambiente interno (escritório proprietário). */
export const OWNER_PERMISSIONS = [
  "home.view",
  "clients.view",
  "clients.edit",
  "clients.delete",
  "documents.manage",
  "analyses.start",
  "processes.view",
  "processes.edit",
  "processes.delete",
  "processes.caseValue.view",
  "reviews.view",
  "reviews.decide",
  "finance.view",
  "finance.manage",
  "partners.view",
  "partners.manage",
  "partners.finance.view",
  "partnerRequests.manage",
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

/** Permissões do Portal do Parceiro. Nunca concedidas a papéis internos. */
export const PARTNER_PORTAL_PERMISSIONS = [
  "partnerPortal.view",
  "partnerPortal.clients.create",
  "partnerPortal.clients.edit",
  "partnerPortal.processes.create",
  "partnerPortal.documents.submit",
  "partnerPortal.requests.respond",
  "partnerPortal.finance.view",
  "partnerPortal.users.manage",
] as const;

export const PERMISSIONS = [...OWNER_PERMISSIONS, ...PARTNER_PORTAL_PERMISSIONS] as const;
export type Permission = (typeof PERMISSIONS)[number];

const PARTNER_BASE: readonly Permission[] = [
  "home.view",
  "clients.view",
  "processes.view",
  "processes.caseValue.view",
  "partnerPortal.view",
  "partnerPortal.clients.create",
  "partnerPortal.clients.edit",
  "partnerPortal.processes.create",
  "partnerPortal.documents.submit",
  "partnerPortal.requests.respond",
  "demo.tools",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: OWNER_PERMISSIONS,
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
    "partners.view",
    "partnerRequests.manage",
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
    "partnerRequests.manage",
    "demo.tools",
  ],
  PARTNER_ADMIN: [...PARTNER_BASE, "partnerPortal.finance.view", "partnerPortal.users.manage"],
  PARTNER_USER: PARTNER_BASE,
};

const PERMISSION_SETS: Record<Role, ReadonlySet<Permission>> = {
  ADMIN: new Set(ROLE_PERMISSIONS.ADMIN),
  LAWYER: new Set(ROLE_PERMISSIONS.LAWYER),
  ASSISTANT: new Set(ROLE_PERMISSIONS.ASSISTANT),
  PARTNER_ADMIN: new Set(ROLE_PERMISSIONS.PARTNER_ADMIN),
  PARTNER_USER: new Set(ROLE_PERMISSIONS.PARTNER_USER),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return PERMISSION_SETS[role]?.has(permission) ?? false;
}

export function canAll(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

export function canAny(role: Role | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}
