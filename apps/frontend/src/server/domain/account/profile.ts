import "server-only";

import { z } from "zod";
import { EMPTY_PERSONAL_PROFILE, normalizePersonalProfile, personalProfileProblems, type PersonalProfileField, type PersonalProfileInput } from "@/lib/account/personal-profile";
import { firstNameOf } from "@/lib/auth/first-name";
import { normalizeOab } from "@/lib/auth/oab";
import type { ServiceContext } from "@/server/core/context";
import { unwrap } from "@/server/core/db-errors";
import { DomainError } from "@/server/core/errors";

/**
 * Cadastro pessoal (079): a etapa obrigatória "Complete seu cadastro" e a tela
 * "Meu perfil". Sempre a PRÓPRIA conta: o usuário vem do JWT (`ctx.session`),
 * nunca do navegador, e o banco grava por `complete_my_profile`, que usa
 * `auth.uid()` e não tem parâmetro de id.
 */

/* ── schema ──────────────────────────────────────────────────────────── */

const text = (max: number) => z.string().max(max).default("");

/** Formato do pedido. As regras de cada campo são as de `personalProfileProblems` (as mesmas do formulário). */
export const personalProfileSchema = z
  .object({
    fullName: text(200),
    preferredName: text(200),
    gender: text(20),
    birthDate: text(10),
    phone: text(30),
    jobTitle: text(200),
    officeCity: text(200),
    officeState: text(2),
    /** OABs novas informadas na etapa obrigatória (a primeira vira a principal se a pessoa ainda não tiver nenhuma). */
    newOabs: z.array(z.object({ number: z.string().max(20), state: z.string().max(2) })).max(5).default([]),
  })
  .superRefine((value, ctx) => {
    const problems = personalProfileProblems(value);
    for (const [field, message] of Object.entries(problems) as [PersonalProfileField, string][]) {
      ctx.addIssue({ code: "custom", path: [field], message });
    }
    value.newOabs.forEach((oab, index) => {
      const normalized = normalizeOab(oab);
      if (normalized === "invalid" || normalized === null) {
        ctx.addIssue({ code: "custom", path: ["newOabs", index], message: "Informe o número da OAB (só números) e a UF." });
      }
    });
  });

export type SavePersonalProfileInput = z.infer<typeof personalProfileSchema>;

/* ── DTO ─────────────────────────────────────────────────────────────── */

export interface MyProfileDTO {
  email: string;
  profile: PersonalProfileInput;
  /** Nulo = cadastro pessoal ainda pendente. */
  completedAt: string | null;
}

interface ProfileRow {
  full_name: string;
  preferred_name: string | null;
  gender: string | null;
  birth_date: string | null;
  phone: string | null;
  job_title: string | null;
  office_city: string | null;
  office_state: string | null;
  profile_completed_at: string | null;
}

const PROFILE_COLUMNS = "full_name, preferred_name, gender, birth_date, phone, job_title, office_city, office_state, profile_completed_at";

function toDTO(row: ProfileRow, email: string): MyProfileDTO {
  return {
    email,
    profile: {
      ...EMPTY_PERSONAL_PROFILE,
      fullName: row.full_name,
      preferredName: row.preferred_name ?? "",
      gender: row.gender ?? "",
      birthDate: row.birth_date ?? "",
      phone: (row.phone ?? "").replace(/\D/g, ""),
      jobTitle: row.job_title ?? "",
      officeCity: row.office_city ?? "",
      officeState: row.office_state ?? "",
    },
    completedAt: row.profile_completed_at,
  };
}

/* ── repository ──────────────────────────────────────────────────────── */

async function findMyProfileRow(ctx: ServiceContext): Promise<ProfileRow> {
  const row = unwrap(await ctx.db.from("profiles").select(PROFILE_COLUMNS).eq("id", ctx.session.userId).maybeSingle()) as ProfileRow | null;
  if (!row) throw new DomainError("NOT_FOUND");
  return row;
}

async function saveMyProfileRow(ctx: ServiceContext, input: PersonalProfileInput): Promise<{ firstTime: boolean }> {
  const data = unwrap(
    await ctx.db.rpc("complete_my_profile", {
      p: {
        full_name: input.fullName,
        preferred_name: input.preferredName || null,
        gender: input.gender || null,
        birth_date: input.birthDate || null,
        phone: input.phone || null,
        job_title: input.jobTitle || null,
        office_city: input.officeCity,
        office_state: input.officeState,
      },
    }),
  ) as { first_time?: boolean } | null;
  return { firstTime: data?.first_time === true };
}

/* ── service ─────────────────────────────────────────────────────────── */

export async function getMyProfile(ctx: ServiceContext): Promise<MyProfileDTO> {
  return toDTO(await findMyProfileRow(ctx), ctx.session.email);
}

export async function saveMyProfile(ctx: ServiceContext, input: SavePersonalProfileInput): Promise<MyProfileDTO & { firstTime: boolean }> {
  const { newOabs, ...fields } = input;
  const profile = normalizePersonalProfile(fields);
  const { firstTime } = await saveMyProfileRow(ctx, profile);

  // OABs informadas na etapa: a primeira vira a principal se ainda não houver nenhuma.
  if (newOabs.length) {
    const existing = (unwrap(await ctx.db.from("profile_oabs").select("id").eq("user_id", ctx.session.userId).limit(1)) ?? []) as { id: string }[];
    let makePrimary = existing.length === 0;
    for (const raw of newOabs) {
      const oab = normalizeOab(raw);
      if (!oab || oab === "invalid") continue;
      unwrap(await ctx.db.rpc("add_my_oab", { p_number: oab.number, p_state: oab.state, p_primary: makePrimary }));
      makePrimary = false;
    }
  }

  // O nome também vai para os e-mails do Auth (saudação). Não é autorização e
  // não impede a gravação: se falhar, fica só o registro no log.
  if (profile.fullName !== ctx.session.fullName) {
    const { error } = await ctx.db.auth.updateUser({ data: { full_name: profile.fullName, first_name: firstNameOf(profile.fullName) } });
    if (error) ctx.log.warn("account.profile.auth_metadata_failed", { message: error.message });
  }

  return { ...toDTO(await findMyProfileRow(ctx), ctx.session.email), firstTime };
}
