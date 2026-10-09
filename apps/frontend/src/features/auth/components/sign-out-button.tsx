"use client";

import { useTransition } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { signOut } from "@/server/auth/actions";

/** Logout real: o servidor encerra a sessão do Supabase e apaga os cookies. */
export function SignOutButton({ label = "Sair", variant = "link" }: { label?: string; variant?: ButtonVariant }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant={variant} loading={pending} onClick={() => startTransition(() => signOut())}>
      {label}
    </Button>
  );
}
