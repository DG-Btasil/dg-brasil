"use client";

import { TeamManager } from "@/features/team/team-manager";
import { PermissionMatrix } from "./permission-matrix";

/** Equipe real (Supabase) + matriz de permissões por papel. */
export function TeamSection() {
  return (
    <div className="space-y-6">
      <TeamManager />
      <PermissionMatrix />
    </div>
  );
}
