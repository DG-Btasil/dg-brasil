import type { Role } from "@/lib/permissions";
import { firstNameOf } from "./first-name";

/**
 * Dados que vão para `user_metadata` no Supabase Auth SÓ para os templates de
 * e-mail (supabase/templates) montarem o texto: saudação, público do convite,
 * escritório.
 *
 * ⚠ NUNCA use nada daqui para autorização. `user_metadata` é editável pelo
 * próprio usuário (`auth.updateUser({ data })`) e vai dentro do JWT. Papel e
 * escritório REAIS vêm de `organization_memberships`, lidos a cada requisição
 * (getCurrentSession / RLS). `metadata-guard.test.ts` falha se algum código de
 * autorização ou migration passar a ler esses campos.
 *
 * Os dados de convite são APAGADOS no aceite (`acceptedInviteMetadata`): depois
 * de entrar, a conta não carrega mais "papel do convite" nenhum.
 */
export const EMAIL_METADATA_KEYS = ["full_name", "first_name", "invite_role", "organization_name", "invite_pending"] as const;
export type EmailMetadataKey = (typeof EMAIL_METADATA_KEYS)[number];

export interface InviteMetadata {
  full_name: string;
  first_name: string;
  /** Só escolhe o texto do e-mail de convite. Não é o papel da pessoa. */
  invite_role: Role;
  organization_name: string | null;
  /**
   * Conta já confirmada sendo reconvidada: o Supabase manda o e-mail de
   * RECUPERAÇÃO (não aceita convite para conta confirmada) e o template de
   * recuperação usa esta marca para falar de convite, não de "redefinir senha".
   */
  invite_pending: true | null;
}

/** Depois do aceite: mantém só o nome; `null` APAGA a chave no Supabase Auth. */
export function acceptedInviteMetadata(fullName: string): Record<EmailMetadataKey, string | null> {
  return {
    full_name: fullName,
    first_name: firstNameOf(fullName),
    invite_role: null,
    organization_name: null,
    invite_pending: null,
  };
}

export function buildInviteMetadata(input: {
  fullName: string;
  role: Role;
  organizationName: string | null;
  reinviteOfConfirmedAccount: boolean;
}): InviteMetadata {
  return {
    full_name: input.fullName,
    first_name: firstNameOf(input.fullName),
    invite_role: input.role,
    // Vem do banco (cadastro do escritório, gerido pelo ADMIN). O template
    // escapa HTML; aqui só se limita o tamanho e tira caractere de controle.
    organization_name: input.organizationName?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || null,
    invite_pending: input.reinviteOfConfirmedAccount ? true : null,
  };
}

/* ------------------------------------------------------------------ */
/* Nome de pessoa (convidado e primeiro acesso)                        */

// Mesma regra de private.valid_person_name (migration 023). Mudou lá, mude aqui.
const LETTER = "A-Za-zÀ-ÖØ-öø-ÿĀ-ž";
const NAME_SHAPE = new RegExp(`^[${LETTER}][${LETTER} .'’-]*[${LETTER}.]$`);

/** Espaços nas pontas e repetidos removidos. */
export function normalizePersonName(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * O nome do convidado aparece no e-mail enviado em nome do escritório. Só
 * letras (com acento), espaço, apóstrofo, hífen e ponto de abreviação — sem
 * número, @, barra ou domínio — para ninguém usar o campo para escrever um
 * golpe ("Acesse www…", "Pague R$…") dentro de um e-mail com a nossa marca.
 */
export function personNameProblem(raw: string): string | null {
  const name = normalizePersonName(raw);
  if (name.length < 2) return "Informe o nome completo.";
  if (name.length > 120) return "Nome muito longo (máximo de 120 caracteres).";
  if (
    !NAME_SHAPE.test(name) ||
    /\.[^ ]/.test(name) ||
    /[.'’-]{2}/.test(name) ||
    / [.'’-]/.test(name) ||
    /['’-] /.test(name) ||
    name.split(" ").some((word) => word.length > 40)
  ) {
    return "Use só letras, espaços, apóstrofo, hífen e ponto de abreviação no nome.";
  }
  return null;
}
