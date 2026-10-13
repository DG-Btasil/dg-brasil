"use server";

import { createHash, randomBytes } from "node:crypto";
import { sanitizeForLog } from "@/lib/auth/errors";
import { firstNameOf } from "@/lib/auth/first-name";
import { ALL_ROLES, can, type Role } from "@/lib/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";
import { emailLinkOrigin } from "./origin";
import { AuthorizationError, authorizeAction } from "./session";
import type { AppSession } from "@/lib/auth/types";

/**
 * Gestão de equipe (ADMIN: qualquer escritório; PARTNER_ADMIN: só o próprio).
 *
 * Toda regra de negócio (quem convida quem, último ADMIN, IDOR entre
 * escritórios, auditoria) está nas funções do banco (migration 022) e roda
 * com o JWT de quem age. A service role aparece só onde o Supabase Auth exige
 * (enviar o e-mail, remover fatores de MFA) — DEPOIS da autorização do banco.
 */

export interface TeamMember {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  membershipStatus: "ACTIVE" | "SUSPENDED" | "REMOVED" | "INVITED";
  profileActive: boolean;
  mfaEnabled: boolean;
  lastSignInAt: string | null;
  joinedAt: string | null;
}

export interface PendingInvitation {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  expiresAt: string;
  createdAt: string;
  expired: boolean;
}

export interface TeamOrganization {
  id: string;
  name: string;
  type: "OWNER" | "PARTNER";
  status: string;
}

export interface TeamData {
  organization: TeamOrganization;
  /** Só para ADMIN: escritórios que pode administrar. */
  organizations: TeamOrganization[];
  members: TeamMember[];
  invitations: PendingInvitation[];
  viewer: { userId: string; role: Role; canResetMfa: boolean; canDeactivateUsers: boolean };
}

const GENERIC = "Não foi possível concluir agora. Tente novamente em instantes.";

/** Mensagens que o próprio banco já escreve para a pessoa usuária. */
const SAFE_DB_MESSAGES = new Set([
  "Papel interno só no escritório proprietário",
  "Escritório parceiro inválido",
  "Administrador do parceiro só convida usuários do parceiro",
  "Convite só para o próprio escritório",
  "Sem permissão para convidar",
  "Escritório sem acesso ativo",
  "Convite não encontrado",
  "Convite já aceito",
  "Usuário não encontrado",
  "Você não pode alterar o próprio acesso",
  "Não é possível remover o último administrador ativo",
  "Papel não permitido",
  "Status inválido",
  "Somente ADMIN interno ativa ou inativa usuários",
  "Sem permissão para ver a equipe",
  "Verificação em duas etapas obrigatória",
]);

function dbErrorMessage(error: { message?: string; code?: string } | null, session: AppSession): string {
  const message = error?.message ?? "";
  if (message === "EMAIL_ALREADY_HAS_ACCESS") {
    // O parceiro não descobre se um e-mail já tem conta em outro escritório.
    return session.role === "ADMIN"
      ? "Este e-mail já tem acesso ativo ao DG Brasil."
      : "Não foi possível convidar este e-mail. Se o problema continuar, fale com o escritório Bárbara Cardoso.";
  }
  if (SAFE_DB_MESSAGES.has(message)) return message;
  return GENERIC;
}

async function authorizeTeamManager(): Promise<AppSession> {
  const session = await authorizeAction();
  if (!can(session.role, "settings.team.manage") && !can(session.role, "partnerPortal.users.manage")) {
    throw new AuthorizationError();
  }
  return session;
}

async function run<T>(label: string, fn: (session: AppSession) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const session = await authorizeTeamManager();
    return await fn(session);
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, error: error.message };
    console.error(`[equipe] ${label}`, sanitizeForLog(error));
    return { ok: false, error: GENERIC };
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */

export async function getTeamData(organizationId?: string): Promise<ActionResult<TeamData>> {
  return run("listar equipe", async (session) => {
    const supabase = await createSupabaseServerClient();
    // PARTNER_ADMIN: sempre o próprio escritório, ignorando o que vier do navegador.
    const orgId = session.role === "ADMIN" && organizationId && UUID.test(organizationId) ? organizationId : session.organizationId;

    const [members, invitations, orgs] = await Promise.all([
      supabase.rpc("get_team_members", { p_organization_id: orgId }),
      supabase
        .from("user_invitations")
        .select("id, email, full_name, role, expires_at, created_at")
        .eq("organization_id", orgId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("organizations")
        .select("id, name, type, status")
        .is("deleted_at", null)
        .order("type", { ascending: false })
        .order("name"),
    ]);
    if (members.error) return { ok: false, error: dbErrorMessage(members.error, session) };
    if (invitations.error || orgs.error) {
      console.error("[equipe] leitura", sanitizeForLog(invitations.error ?? orgs.error));
      return { ok: false, error: GENERIC };
    }

    const organizations = (orgs.data ?? []) as TeamOrganization[];
    const organization = organizations.find((o) => o.id === orgId);
    if (!organization) return { ok: false, error: "Escritório não encontrado." };
    const now = Date.now();

    return {
      ok: true,
      data: {
        organization,
        organizations: session.role === "ADMIN" ? organizations : [],
        members: (members.data ?? []).map((m: Record<string, unknown>) => ({
          membershipId: m.membership_id as string,
          userId: m.user_id as string,
          fullName: (m.full_name as string) ?? "",
          email: (m.email as string) ?? "",
          role: m.role as Role,
          membershipStatus: m.membership_status as TeamMember["membershipStatus"],
          profileActive: Boolean(m.profile_active),
          mfaEnabled: Boolean(m.mfa_enabled),
          lastSignInAt: (m.last_sign_in_at as string) ?? null,
          joinedAt: (m.joined_at as string) ?? null,
        })),
        invitations: (invitations.data ?? []).map((i) => ({
          id: i.id,
          email: i.email,
          fullName: i.full_name,
          role: i.role as Role,
          expiresAt: i.expires_at,
          createdAt: i.created_at,
          expired: new Date(i.expires_at).getTime() <= now,
        })),
        viewer: {
          userId: session.userId,
          role: session.role,
          canResetMfa: session.role === "ADMIN",
          canDeactivateUsers: session.role === "ADMIN",
        },
      },
    };
  });
}

export interface InviteInput {
  email: string;
  fullName: string;
  role: Role;
  organizationId?: string;
}

/** Lido pelo template de convite (supabase/templates). `null` apaga a chave. */
interface InviteMetadata {
  full_name: string;
  first_name: string;
  invite_role: Role;
  organization_name: string | null;
}

/**
 * Envia o e-mail do convite pelo Supabase Auth.
 * - Conta nova: `inviteUserByEmail` cria a conta já com os dados do convite.
 * - Conta existente e ainda não confirmada (reenvio, ou convite refeito com
 *   outro papel/escritório): o Auth reenvia o convite, mas IGNORA `data`.
 *   Por isso `generateLink` (não envia nada) devolve a conta, os dados são
 *   atualizados e o convite é reenviado — com o template de convite.
 * - Conta já confirmada (ex.: acesso removido antes): o Auth recusa convite;
 *   o link de recuperação prova o e-mail e leva ao mesmo primeiro acesso.
 */
async function sendInvitationEmail(email: string, redirectTo: string, metadata: InviteMetadata, existingAuthUser: boolean) {
  const admin = createSupabaseAdminClient();
  if (!existingAuthUser) {
    return (await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: metadata })).error;
  }
  const link = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (link.error) {
    if (link.error.code !== "email_exists") return link.error;
    return (await admin.auth.resetPasswordForEmail(email, { redirectTo })).error;
  }
  const updated = await admin.auth.admin.updateUserById(link.data.user.id, { user_metadata: metadata });
  if (updated.error) return updated.error;
  return (await admin.auth.admin.inviteUserByEmail(email, { redirectTo })).error;
}

/**
 * Convite: (1) o banco valida e grava o convite com o HASH de um token
 * aleatório; (2) o Supabase Auth envia o e-mail com o link de credencial,
 * que volta para /auth/confirm levando o token de referência. O token em
 * claro só existe neste instante e no e-mail — nunca em log nem no banco.
 */
export async function inviteUser(input: InviteInput): Promise<ActionResult> {
  return run("convidar", async (session) => {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!EMAIL.test(email) || email.length > 254) return { ok: false, error: "Informe um e-mail válido." };
    if (fullName.length < 3) return { ok: false, error: "Informe o nome completo." };
    if (!ALL_ROLES.includes(input.role)) return { ok: false, error: "Papel não permitido" };
    const orgId = session.role === "ADMIN" && input.organizationId && UUID.test(input.organizationId) ? input.organizationId : session.organizationId;

    const ref = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(ref).digest("hex");

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_invitation", {
      p_email: email,
      p_full_name: fullName,
      p_role: input.role,
      p_organization_id: orgId,
      p_token_hash: tokenHash,
    });
    if (error) return { ok: false, error: dbErrorMessage(error, session) };
    const created = data as { invitation_id: string; organization_id: string; existing_auth_user: boolean };

    // O e-mail muda conforme o público (equipe interna, administrador do
    // parceiro, integrante do parceiro) e mostra o escritório do convite.
    const { data: org } = await supabase.from("organizations").select("name").eq("id", created.organization_id).maybeSingle();
    const metadata: InviteMetadata = {
      full_name: fullName,
      first_name: firstNameOf(fullName),
      invite_role: input.role,
      organization_name: org?.name ?? null,
    };

    const redirectTo = `${await emailLinkOrigin(input.role)}/auth/confirm?fluxo=convite&ref=${ref}`;
    const mailError = await sendInvitationEmail(email, redirectTo, metadata, created.existing_auth_user);

    if (mailError) {
      console.error("[equipe] envio do convite", sanitizeForLog(mailError));
      await supabase.rpc("revoke_invitation", { p_invitation_id: created.invitation_id });
      return { ok: false, error: "O convite não pôde ser enviado por e-mail. Nada foi criado; tente novamente." };
    }
    return { ok: true };
  });
}

/** Reenvio = novo convite com novo token; o anterior é revogado pelo banco. */
export async function resendInvitation(invitationId: string): Promise<ActionResult> {
  if (!UUID.test(invitationId)) return { ok: false, error: "Convite não encontrado" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("user_invitations")
    .select("email, full_name, role, organization_id, accepted_at, revoked_at")
    .eq("id", invitationId)
    .maybeSingle();
  // RLS: só aparece para quem pode administrar aquele escritório.
  if (!data || data.accepted_at || data.revoked_at) return { ok: false, error: "Convite não encontrado" };
  return inviteUser({
    email: data.email,
    fullName: data.full_name ?? data.email.split("@")[0],
    role: data.role as Role,
    organizationId: data.organization_id,
  });
}

export async function revokeInvitation(invitationId: string): Promise<ActionResult> {
  return run("revogar convite", async (session) => {
    if (!UUID.test(invitationId)) return { ok: false, error: "Convite não encontrado" };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_invitation_id: invitationId });
    return error ? { ok: false, error: dbErrorMessage(error, session) } : { ok: true };
  });
}

/** Troca de papel: vale na próxima requisição da pessoa (sem esperar o token). */
export async function changeMemberRole(membershipId: string, role: Role): Promise<ActionResult> {
  return run("trocar papel", async (session) => {
    if (!UUID.test(membershipId) || !ALL_ROLES.includes(role)) return { ok: false, error: "Papel não permitido" };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_membership_role", { p_membership_id: membershipId, p_role: role });
    return error ? { ok: false, error: dbErrorMessage(error, session) } : { ok: true };
  });
}

/** Suspender / reativar / remover o vínculo. Efeito imediato (RLS e sessão leem o banco). */
export async function setMemberStatus(membershipId: string, status: "ACTIVE" | "SUSPENDED" | "REMOVED"): Promise<ActionResult> {
  return run("status do vínculo", async (session) => {
    if (!UUID.test(membershipId) || !["ACTIVE", "SUSPENDED", "REMOVED"].includes(status)) {
      return { ok: false, error: "Status inválido" };
    }
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_membership_status", { p_membership_id: membershipId, p_status: status });
    return error ? { ok: false, error: dbErrorMessage(error, session) } : { ok: true };
  });
}

/** Inativar a CONTA inteira (todas as organizações). Só ADMIN. */
export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  return run("ativar/inativar conta", async (session) => {
    if (session.role !== "ADMIN") throw new AuthorizationError();
    if (!UUID.test(userId)) return { ok: false, error: "Usuário não encontrado" };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc("set_profile_active", { p_user_id: userId, p_active: active });
    return error ? { ok: false, error: dbErrorMessage(error, session) } : { ok: true };
  });
}

/**
 * Redefinição de MFA (celular perdido). Operação ADMINISTRATIVA, auditada:
 * remove os fatores TOTP da pessoa; no próximo login ela cadastra um novo.
 * Não existe "desativar MFA": sem fator, o acesso para no cadastro de MFA.
 */
export async function resetUserMfa(userId: string): Promise<ActionResult<{ removed: number }>> {
  return run("redefinir MFA", async (session) => {
    if (session.role !== "ADMIN") throw new AuthorizationError();
    if (!UUID.test(userId)) return { ok: false, error: "Usuário não encontrado" };
    if (userId === session.userId) return { ok: false, error: "Você não pode alterar o próprio acesso" };

    const admin = createSupabaseAdminClient();
    // O banco revalida que o ator é ADMIN ativo e registra a auditoria.
    const requested = await admin.rpc("record_auth_event", {
      p_action: "MFA_RESET_REQUESTED",
      p_target_user: userId,
      p_metadata: {},
      p_actor: session.userId,
    });
    if (requested.error) return { ok: false, error: dbErrorMessage(requested.error, session) };

    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) {
      console.error("[equipe] listar fatores", sanitizeForLog(error));
      return { ok: false, error: GENERIC };
    }
    let removed = 0;
    for (const factor of data?.factors ?? []) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (delError) {
        console.error("[equipe] remover fator", sanitizeForLog(delError));
        return { ok: false, error: GENERIC };
      }
      removed += 1;
    }
    await admin.rpc("record_auth_event", {
      p_action: "MFA_RESET_COMPLETED",
      p_target_user: userId,
      p_metadata: { factors_removed: removed },
      p_actor: session.userId,
    });
    return { ok: true, data: { removed } };
  });
}
