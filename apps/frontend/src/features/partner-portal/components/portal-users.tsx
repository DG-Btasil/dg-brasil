"use client";

import { TeamManager } from "@/features/team/team-manager";

/**
 * Usuários do próprio escritório (administrador do parceiro). Gestão REAL:
 * o servidor sempre usa o escritório da sessão, nunca um id vindo da tela.
 */
export function UsersPanel() {
  return (
    <TeamManager
      title="Usuários do escritório"
      description="Convide e gerencie quem acessa o portal pelo seu escritório. Mudanças valem na hora e ficam registradas."
    />
  );
}
