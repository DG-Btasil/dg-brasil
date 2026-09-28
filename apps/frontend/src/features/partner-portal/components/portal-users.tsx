"use client";

import { useState } from "react";
import { InvitePartnerUserDialog } from "@/features/partners/components/partner-dialogs";
import { PartnerUsersPanel } from "@/features/partners/components/partner-detail";
import type { ID } from "@/types";

/** Gestão dos usuários do próprio escritório (Partner Admin). As ações validam o escritório da sessão. */
export function UsersPanel({ partnerOfficeId }: { partnerOfficeId: ID }) {
  const [inviting, setInviting] = useState(false);
  return (
    <>
      <PartnerUsersPanel partnerId={partnerOfficeId} onInvite={() => setInviting(true)} />
      {inviting && <InvitePartnerUserDialog partnerOfficeId={partnerOfficeId} open onOpenChange={(o) => !o && setInviting(false)} />}
    </>
  );
}
