"use client";

import { useCallback, useMemo } from "react";
import { useCan } from "@/features/auth/hooks";
import { useClientSession } from "@/features/auth/session-context";
import { usePreferences } from "@/features/offices/hooks";
import { NOTIFICATION_TYPES } from "@/lib/constants/status";
import type { Permission } from "@/lib/permissions";
import { repositories } from "@/repositories";
import type { UserPreferences } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { ID } from "@/types";

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

export function defaultPreferences(): UserPreferences {
  const notifications = Object.fromEntries(
    NOTIFICATION_TYPES.map((t) => [t, { inApp: true, email: t === "DEADLINE" || t === "INTEGRATION_ISSUE" }]),
  ) as UserPreferences["notifications"];
  return { notifications, digest: "DAILY" };
}

/** Preferências salvas do usuário atual, ou os padrões. */
export function useMyPreferences(): { userId: ID | undefined; preferences: UserPreferences; saved: boolean } {
  const userId = useClientSession()?.userId;
  const all = usePreferences();
  return useMemo(() => {
    const saved = userId ? all[userId] : undefined;
    return { userId, preferences: saved ?? defaultPreferences(), saved: Boolean(saved) };
  }, [userId, all]);
}

/** Preferências de notificação (demonstração: o envio de e-mail/SMTP está fora desta etapa). */
export function useSettingsActions() {
  const toast = useToast();

  const savePreferences = useCallback(
    async (userId: ID, prefs: UserPreferences) => {
      try {
        await repositories.users.savePreferences(userId, prefs);
        toast({ tone: "success", title: "Preferências de notificação salvas" });
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar as preferências." });
      }
    },
    [toast],
  );

  return { savePreferences };
}
