"use client";

import { useMemo } from "react";
import { useCan } from "@/features/auth/hooks";
import type { Permission } from "@/lib/permissions";

export const SETTINGS_SECTIONS = ["geral", "equipe", "integracoes", "ia", "honorarios", "notificacoes", "conta", "seguranca"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** `permission: null` = toda sessão liberada (cuidar da própria conta não depende do papel). */
export const SECTION_META: Record<SettingsSection, { label: string; description: string; permission: Permission | null }> = {
  geral: { label: "Geral", description: "Dados do escritório, preferências e identidade", permission: "settings.view" },
  equipe: { label: "Equipe e permissões", description: "Usuários, convites e papéis", permission: "settings.team.manage" },
  integracoes: { label: "Integrações", description: "Integração Judicial, importação de dados (XLSX/CSV), e-mail", permission: "settings.integrations.view" },
  ia: { label: "Computador do escritório", description: "Quem executa os agentes, a fila e o interruptor geral", permission: "settings.ai.view" },
  honorarios: { label: "Modelos de honorários", description: "Modelos usados nos contratos", permission: "settings.fees.manage" },
  notificacoes: { label: "Notificações", description: "Suas preferências de aviso", permission: "settings.notifications.edit" },
  conta: { label: "Sua conta e sessões", description: "Senha, verificação em duas etapas e dispositivos", permission: null },
  seguranca: { label: "Segurança e auditoria", description: "Postura do escritório e registro de atividades", permission: "settings.security.view" },
};

/** Seções permitidas para o papel atual (as demais não são renderizadas). */
export function useAllowedSections(): SettingsSection[] {
  const can = useCan();
  return useMemo(() => SETTINGS_SECTIONS.filter((s) => {
        const permission = SECTION_META[s].permission;
        return permission === null || can(permission);
      }), [can]);
}
