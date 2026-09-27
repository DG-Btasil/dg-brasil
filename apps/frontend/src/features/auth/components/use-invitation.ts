"use client";

import { useMemo } from "react";
import { useInvitations, useOffice, useUsers } from "@/features/offices/hooks";
import type { Invitation } from "@/types";

export type InvitationLookup =
  | { state: "valid"; invitation: Invitation; officeName: string; inviterName: string }
  | { state: "used"; invitation: Invitation }
  | { state: "invalid" };

/** Localiza um convite pelo token (leitura reativa, sem efeitos). */
export function useInvitationLookup(token: string): InvitationLookup {
  const invitations = useInvitations();
  const users = useUsers();
  const office = useOffice();
  return useMemo(() => {
    const invitation = invitations.find((i) => i.token === token);
    if (!invitation) return { state: "invalid" };
    if (invitation.acceptedAt) return { state: "used", invitation };
    const inviter = users.find((u) => u.id === invitation.invitedBy);
    return { state: "valid", invitation, officeName: office.name, inviterName: inviter?.name ?? "A administração do escritório" };
  }, [invitations, users, office.name, token]);
}
