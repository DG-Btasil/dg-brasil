"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/form";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABEL, type NotificationType } from "@/lib/constants/status";
import type { UserPreferences } from "@/store/types";
import type { ID } from "@/types";
import { defaultPreferences, useMyPreferences, useSettingsActions } from "../../hooks";
import { SectionHeader } from "../section-header";

const DIGEST_OPTIONS: { value: UserPreferences["digest"]; label: string; description: string }[] = [
  { value: "NONE", label: "Sem resumo", description: "Apenas os avisos individuais." },
  { value: "DAILY", label: "Diário", description: "Um e-mail por dia com as pendências." },
  { value: "WEEKLY", label: "Semanal", description: "Um e-mail por semana, às segundas." },
];

export function NotificationsSection() {
  const { userId, preferences, saved } = useMyPreferences();
  return (
    <div>
      <SectionHeader title="Notificações" description="Como você quer ser avisado. As preferências valem apenas para o seu usuário." />
      {userId && <PreferencesForm key={`${userId}-${saved}`} userId={userId} initial={preferences} saved={saved} />}
    </div>
  );
}

function PreferencesForm({ userId, initial, saved }: { userId: ID; initial: UserPreferences; saved: boolean }) {
  const [draft, setDraft] = useState<UserPreferences>(initial);
  const [saving, setSaving] = useState(false);
  const { savePreferences } = useSettingsActions();
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function toggle(type: NotificationType, channel: "inApp" | "email") {
    setDraft((d) => ({
      ...d,
      notifications: { ...d.notifications, [type]: { ...d.notifications[type], [channel]: !d.notifications[type][channel] } },
    }));
  }

  async function save() {
    setSaving(true);
    await savePreferences(userId, draft);
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          title="Avisos por tipo"
          description={saved ? "Preferências salvas." : "Você está usando as preferências padrão."}
        />
        <Table caption="Canais de aviso por tipo de notificação">
          <THead>
            <tr>
              <Th>Tipo de aviso</Th>
              <Th className="w-[160px] text-center">Na plataforma</Th>
              <Th className="w-[160px] text-center">Por e-mail</Th>
            </tr>
          </THead>
          <TBody>
            {NOTIFICATION_TYPES.map((type) => {
              const pref = draft.notifications[type] ?? { inApp: true, email: false };
              return (
                <Tr key={type}>
                  <Th scope="row" className="h-auto py-2.5 text-[13px] font-normal normal-case tracking-normal text-foreground">
                    {NOTIFICATION_TYPE_LABEL[type]}
                  </Th>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-navy"
                      checked={pref.inApp}
                      onChange={() => toggle(type, "inApp")}
                      aria-label={`${NOTIFICATION_TYPE_LABEL[type]} na plataforma`}
                    />
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-navy"
                      checked={pref.email}
                      onChange={() => toggle(type, "email")}
                      aria-label={`${NOTIFICATION_TYPE_LABEL[type]} por e-mail`}
                    />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Panel>

      <Panel>
        <PanelHeader title="Resumo por e-mail" description="Consolidado das pendências do escritório para o seu perfil." />
        <div className="px-5 py-4">
          <ChoiceCards legend="Frequência do resumo" name="digest" value={draft.digest} onChange={(digest) => setDraft((d) => ({ ...d, digest }))} options={DIGEST_OPTIONS} />
          <p className="mt-3 text-[12px] text-muted">Nesta demonstração nenhum e-mail é enviado.</p>
        </div>
        <PanelFooter>
          <Button variant="ghost" onClick={() => setDraft(defaultPreferences())}>
            Restaurar padrão
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={save}>
            Salvar preferências
          </Button>
        </PanelFooter>
      </Panel>
    </div>
  );
}
