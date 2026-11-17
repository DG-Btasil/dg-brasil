import { normalizePersonName, personNameProblem } from "@/lib/auth/invite-metadata";
import { BRAZILIAN_STATES } from "@/lib/constants/legal";

/**
 * Cadastro pessoal (079): os dados que a PRÓPRIA pessoa informa na etapa
 * "Complete seu cadastro" e edita em "Meu perfil". Regras puras, usadas pelo
 * formulário e pelo servidor; o banco (complete_my_profile) confere de novo.
 *
 * LGPD, minimização: só o que tem finalidade. Gênero serve ao tratamento nos
 * textos; data de nascimento, ao aviso de aniversário à equipe. Os dois são
 * opcionais. Nada de CPF, endereço residencial ou documento pessoal aqui.
 */

export const GENDERS = ["FEMALE", "MALE", "OTHER", "UNDISCLOSED"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABEL: Record<Gender, string> = {
  FEMALE: "Feminino",
  MALE: "Masculino",
  OTHER: "Outro",
  UNDISCLOSED: "Prefiro não informar",
};

export const GENDER_OPTIONS = GENDERS.map((value) => ({ value, label: GENDER_LABEL[value] }));
export const UF_OPTIONS = BRAZILIAN_STATES.map((uf) => ({ value: uf as string, label: uf as string }));

/** O que o formulário envia. Texto vazio = campo opcional não informado. */
export interface PersonalProfileInput {
  fullName: string;
  preferredName: string;
  gender: string;
  /** AAAA-MM-DD (o valor de um `<input type="date">`). */
  birthDate: string;
  phone: string;
  jobTitle: string;
  officeCity: string;
  officeState: string;
}

export type PersonalProfileField = keyof PersonalProfileInput;

export const EMPTY_PERSONAL_PROFILE: PersonalProfileInput = {
  fullName: "",
  preferredName: "",
  gender: "",
  birthDate: "",
  phone: "",
  jobTitle: "",
  officeCity: "",
  officeState: "",
};

const collapse = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");

/** Como o servidor grava: espaços normalizados, telefone só com dígitos, UF em maiúsculas. */
export function normalizePersonalProfile(input: PersonalProfileInput): PersonalProfileInput {
  return {
    fullName: normalizePersonName(input.fullName),
    preferredName: collapse(input.preferredName),
    gender: input.gender.trim().toUpperCase(),
    birthDate: input.birthDate.trim(),
    phone: input.phone.replace(/\D/g, ""),
    jobTitle: collapse(input.jobTitle),
    officeCity: collapse(input.officeCity),
    officeState: input.officeState.trim().toUpperCase(),
  };
}

/** Idade em anos completos em `today` (AAAA-MM-DD); null se a data não existe. */
export function ageOn(birthDate: string, today: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - year - (tm < month || (tm === month && td < day) ? 1 : 0);
}

/** Hoje no fuso de Brasília, AAAA-MM-DD. */
export function todayInSaoPaulo(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Problemas por campo (vazio = tudo certo). Obrigatórios: nome completo,
 * cidade e UF de onde a pessoa trabalha.
 */
export function personalProfileProblems(raw: PersonalProfileInput, today: string = todayInSaoPaulo()): Partial<Record<PersonalProfileField, string>> {
  const input = normalizePersonalProfile(raw);
  const problems: Partial<Record<PersonalProfileField, string>> = {};

  const nameProblem = personNameProblem(input.fullName);
  if (nameProblem) problems.fullName = nameProblem;
  else if (!input.fullName.includes(" ")) problems.fullName = "Informe o nome completo, com sobrenome.";

  if (input.preferredName) {
    if (input.preferredName.length > 40) problems.preferredName = "Use até 40 caracteres.";
    else if (personNameProblem(input.preferredName)) problems.preferredName = "Use só letras, espaços, apóstrofo e hífen.";
  }

  if (input.gender && !(GENDERS as readonly string[]).includes(input.gender)) problems.gender = "Escolha uma das opções.";

  if (input.birthDate) {
    const age = ageOn(input.birthDate, today);
    if (age === null) problems.birthDate = "Data inválida.";
    else if (age < 16 || age > 120) problems.birthDate = "Confira a data de nascimento.";
  }

  if (input.phone && (!/^[1-9]\d{9,10}$/.test(input.phone) || input.phone.length > 11)) problems.phone = "Informe o telefone com DDD.";

  if (input.jobTitle.length > 80) problems.jobTitle = "Use até 80 caracteres.";

  if (input.officeCity.length < 2) problems.officeCity = "Informe a cidade onde você trabalha.";
  else if (input.officeCity.length > 80) problems.officeCity = "Use até 80 caracteres.";
  else if (/[0-9@/\\<>]/.test(input.officeCity)) problems.officeCity = "Informe só o nome da cidade.";

  if (!(BRAZILIAN_STATES as readonly string[]).includes(input.officeState)) problems.officeState = "Selecione a UF.";

  return problems;
}

/**
 * O nome veio do e-mail? A conta criada fora do convite (primeira
 * administradora) nasce com a parte do e-mail antes do "@" como nome. Nesse
 * caso o formulário começa com o campo vazio, para a pessoa escrever o nome.
 */
export function nameCameFromEmail(fullName: string, email: string | undefined): boolean {
  const local = email?.split("@")[0]?.trim().toLowerCase();
  return !!local && fullName.trim().toLowerCase() === local;
}
