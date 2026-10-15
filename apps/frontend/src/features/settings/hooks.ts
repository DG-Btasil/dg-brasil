"use client";

import { useMemo } from "react";
import { useCan } from "@/features/auth/hooks";
import type { Permission } from "@/lib/permissions";

export const SETTINGS_SECTIONS = ["geral", "equipe", "integracoes", "ia", "honorarios", "notificacoes", "seguranca"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_META: Record<SettingsSection, { label: string; description: string; permission: Permission }> = {
  geral: { label: "Geral", description: "Dados do escritório, preferências e identidade", permission: "settings.view" },
  equipe: { label: "Equipe e permissões", description: "Usuários, convites e papéis", permission: "settings.team.manage" },
  integracoes: { label: "Integrações", description: "Integração Judicial, importação de dados (XLSX/CSV), e-mail", permission: "settings.integrations.view" },
  ia: { label: "IA e uso", description: "Conexão Claude, execuções e limites", permission: "settings.ai.view" },
  honorarios: { label: "Modelos de honorários", description: "Modelos usados nos contratos", permission: "settings.fees.manage" },
  notificacoes: { label: "Notificações", description: "Suas preferências de aviso", permission: "settings.notifications.edit" },
  seguranca: { label: "Segurança e auditoria", description: "Sessões e registro de atividades", permission: "settings.security.view" },
};

/** Seções permitidas para o papel atual (as demais não são renderizadas). */
export function useAllowedSections(): SettingsSection[] {
  const can = useCan();
  return useMemo(() => SETTINGS_SECTIONS.filter((s) => can(SECTION_META[s].permission)), [can]);
}
