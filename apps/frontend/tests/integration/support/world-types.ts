export type WorldRole = "ADMIN" | "LAWYER" | "ASSISTANT" | "PARTNER_ADMIN_A" | "PARTNER_USER_A" | "PARTNER_ADMIN_B" | "PARTNER_USER_B";

export interface WorldUser {
  id: string;
  email: string;
  organizationId: string;
  /** JWT aal2 (senha + TOTP), válido por 1 h. */
  accessToken: string;
}

export interface World {
  run: string;
  owner: string;
  partnerA: string;
  partnerB: string;
  bankingAreaId: string;
  users: Record<WorldRole, WorldUser>;
}

declare module "vitest" {
  export interface ProvidedContext {
    world: World;
  }
}
