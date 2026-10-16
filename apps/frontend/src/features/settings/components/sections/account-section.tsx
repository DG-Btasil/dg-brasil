"use client";

import { AccountSecurity } from "@/features/account/components/account-security";
import { SectionHeader } from "../section-header";

/** Sua conta e sessões (4.3.2): todo papel interno, sempre a PRÓPRIA conta. */
export function AccountSection() {
  return (
    <div className="space-y-5">
      <SectionHeader title="Sua conta e sessões" description="Senha, verificação em duas etapas e os dispositivos com a sua conta aberta." />
      <AccountSecurity />
    </div>
  );
}
