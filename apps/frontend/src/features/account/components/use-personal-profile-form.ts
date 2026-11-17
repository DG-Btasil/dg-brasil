"use client";

import { useState } from "react";
import { personalProfileProblems, type PersonalProfileField, type PersonalProfileInput } from "@/lib/account/personal-profile";
import { callAction, mapFieldErrors, type ActionResult } from "@/lib/actions/result";
import { formatPhone } from "@/lib/formatting";
import { saveMyProfileAction } from "@/server/domain/account/actions";
import type { MyProfileDTO } from "@/server/domain/account/profile";

type Errors = Partial<Record<PersonalProfileField, string>>;
type Saved = MyProfileDTO & { firstTime: boolean };

const forForm = (profile: PersonalProfileInput): PersonalProfileInput => ({ ...profile, phone: formatPhone(profile.phone) });

/**
 * Estado do formulário do cadastro pessoal (079), compartilhado pela etapa
 * obrigatória e por "Meu perfil": valores, erros por campo e o envio. A
 * conferência daqui é só conforto; quem decide é o servidor.
 */
export function usePersonalProfileForm(initial: PersonalProfileInput) {
  const [value, setValue] = useState<PersonalProfileInput>(() => forForm(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  function onChange(field: PersonalProfileField, next: string) {
    setValue((current) => ({ ...current, [field]: next }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  /** Devolve `null` quando o formulário tem erro de campo (já mostrado). */
  async function submit(newOabs: { number: string; state: string }[] = []): Promise<ActionResult<Saved> | null> {
    const problems = personalProfileProblems(value);
    if (Object.keys(problems).length) {
      setErrors(problems);
      return null;
    }
    setErrors({});
    setSubmitting(true);
    const result = await callAction(() => saveMyProfileAction({ ...value, newOabs }));
    setSubmitting(false);
    if (result.ok) setValue(forForm(result.data.profile));
    else if (result.error.fieldErrors) setErrors(mapFieldErrors(result.error.fieldErrors) as Errors);
    return result;
  }

  return { value, errors, submitting, onChange, submit };
}
