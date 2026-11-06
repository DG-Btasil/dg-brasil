"use client";

import { Field, PasswordInput } from "@/components/ui/form";
import { PASSWORD_HINT } from "@/lib/auth/password-policy";

/** Senha + confirmação, com a política exibida antes do envio. */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  error,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  error?: string;
}) {
  return (
    <>
      <Field label="Nova senha" requirement="required" hint={PASSWORD_HINT} error={error}>
        {(p) => <PasswordInput {...p} autoComplete="new-password" value={password} onChange={(e) => onPassword(e.target.value)} />}
      </Field>
      <Field label="Confirme a nova senha" requirement="required">
        {(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => onConfirm(e.target.value)} />}
      </Field>
    </>
  );
}
