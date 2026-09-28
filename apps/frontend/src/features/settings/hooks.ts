"use client";

import { useCallback, useMemo } from "react";
import { useCan, useCurrentUser } from "@/features/auth/hooks";
import { usePreferences } from "@/features/offices/hooks";
import { NOTIFICATION_TYPES } from "@/lib/constants/status";
import type { Permission } from "@/lib/permissions";
import { repositories } from "@/repositories";
import type { UserPreferences } from "@/store/types";
import { useToast } from "@/store/ui-store";
import type { ID, Office, Role } from "@/types";

export const SETTINGS_SECTIONS = ["geral", "equipe", "integracoes", "ia", "honorarios", "notificacoes", "seguranca", "assinatura"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SECTION_META: Record<SettingsSection, { label: string; description: string; permission: Permission }> = {
  geral: { label: "Geral", description: "Dados do escritório, preferências e identidade", permission: "settings.view" },
  equipe: { label: "Equipe e permissões", description: "Usuários, convites e papéis", permission: "settings.team.manage" },
  integracoes: { label: "Integrações", description: "Integração Judicial, importação de dados, e-mail, WhatsApp", permission: "settings.integrations.view" },
  ia: { label: "IA e consumo", description: "Conexão com a Claude Platform e uso", permission: "settings.ai.view" },
  honorarios: { label: "Modelos de honorários", description: "Modelos usados nos contratos", permission: "settings.fees.manage" },
  notificacoes: { label: "Notificações", description: "Suas preferências de aviso", permission: "settings.notifications.edit" },
  seguranca: { label: "Segurança e auditoria", description: "Sessões e registro de atividades", permission: "settings.security.view" },
  assinatura: { label: "Assinatura", description: "Plano e implantação", permission: "settings.billing.view" },
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
  const user = useCurrentUser();
  const all = usePreferences();
  return useMemo(() => {
    const saved = user ? all[user.id] : undefined;
    return { userId: user?.id, preferences: saved ?? defaultPreferences(), saved: Boolean(saved) };
  }, [user, all]);
}

export function useSettingsActions() {
  const toast = useToast();

  const saveOffice = useCallback(
    async (patch: Partial<Omit<Office, "id" | "onboarding">>) => {
      try {
        await repositories.office.update(patch);
        toast({ tone: "success", title: "Dados do escritório salvos" });
        return true;
      } catch {
        toast({ tone: "danger", title: "Não foi possível salvar os dados do escritório." });
        return false;
      }
    },
    [toast],
  );

  const invite = useCallback(
    async (input: { name: string; email: string; role: Role }): Promise<string | null> => {
      try {
        const token = await repositories.users.invite(input);
        toast({ tone: "success", title: "Convite criado", description: `${input.name} · ${input.email}` });
        return token;
      } catch {
        toast({ tone: "danger", title: "Não foi possível criar o convite." });
        return null;
      }
    },
    [toast],
  );

  const changeRole = useCallback(
    async (userId: ID, role: Role, name: string) => {
      try {
        await repositories.users.changeRole(userId, role);
        toast({ tone: "success", title: "Papel alterado", description: name });
      } catch {
        toast({ tone: "danger", title: "Não foi possível alterar o papel." });
      }
    },
    [toast],
  );

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

  return { saveOffice, invite, changeRole, savePreferences };
}
