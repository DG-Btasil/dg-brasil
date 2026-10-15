"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { can } from "@/lib/permissions";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { ChoiceCards } from "@/components/ui/form";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { getNotificationPreferencesAction, saveNotificationPreferencesAction } from "@/server/domain/notifications/actions";
import type { DigestFrequency, NotificationPreferencesDTO } from "@/server/domain/notifications/preferences";
import { useClientSession } from "@/features/auth/session-context";
import { useToast } from "@/store/ui-store";
import { CATEGORY_INFO, visibleCategories } from "../categories";

const DIGEST_OPTIONS: { value: DigestFrequency; label: string; description: string }[] = [
  { value: "NONE", label: "Sem resumo", description: "Apenas os avisos individuais." },
  { value: "DAILY", label: "Diário", description: "Um e-mail por dia com as pendências." },
  { value: "WEEKLY", label: "Semanal", description: "Um e-mail por semana, às segundas." },
];

/**
 * Preferências de aviso do PRÓPRIO usuário (4.3.1), lidas e gravadas no
 * servidor. "Na plataforma" é respeitado na hora: categoria desligada não
 * gera aviso. E-mail e resumo ficam guardados para quando o envio por e-mail
 * existir — nada é enviado agora, e a tela diz isso. Segurança não desliga.
 */
export function NotificationPreferences() {
  const session = useClientSession();
  const [result, setResult] = useState<ActionResult<NotificationPreferencesDTO> | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    callAction(() => getNotificationPreferencesAction()).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [version]);

  if (!session) return null;
  if (!result) {
    return (
      <Panel>
        <SkeletonRows rows={5} />
      </Panel>
    );
  }
  if (!result.ok) return <ActionErrorState error={result} onRetry={() => setVersion((v) => v + 1)} title="Não foi possível carregar as preferências." />;
  const categories = visibleCategories(session.surface === "PARTNER" ? "PARTNER" : "INTERNAL", (p) => can(session.role, p));
  return <PreferencesForm key={JSON.stringify(result.data)} initial={result.data} categories={categories} onSaved={setResult} />;
}

function PreferencesForm({
  initial,
  categories,
  onSaved,
}: {
  initial: NotificationPreferencesDTO;
  categories: (keyof typeof CATEGORY_INFO)[];
  onSaved: (r: ActionResult<NotificationPreferencesDTO>) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const failed = useActionFeedback();
  const dirty = JSON.stringify({ c: draft.categories, d: draft.digest }) !== JSON.stringify({ c: initial.categories, d: initial.digest });
  const rows = draft.categories.filter((c) => categories.includes(c.category));

  function toggle(category: string, channel: "inApp" | "email") {
    setDraft((d) => ({ ...d, categories: d.categories.map((c) => (c.category === category && !(c.locked && channel === "inApp") ? { ...c, [channel]: !c[channel] } : c)) }));
  }

  async function save(next = draft) {
    setSaving(true);
    const r = await callAction(() =>
      saveNotificationPreferencesAction({ categories: next.categories.map(({ category, inApp, email }) => ({ category, inApp, email })), digest: next.digest }),
    );
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível salvar as preferências.");
      return;
    }
    toast({ tone: "success", title: "Preferências salvas" });
    onSaved(r);
  }

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Avisos por categoria" description={initial.saved ? "Preferências salvas." : "Você está usando as preferências padrão: tudo na plataforma, nada por e-mail."} />
        <Table caption="Canais de aviso por categoria">
          <THead>
            <tr>
              <Th>Categoria</Th>
              <Th className="w-[150px] text-center">Na plataforma</Th>
              <Th className="w-[150px] text-center">Por e-mail</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((c) => {
              const info = CATEGORY_INFO[c.category];
              return (
                <Tr key={c.category}>
                  <Th scope="row" className="h-auto py-2.5 text-[13px] font-normal normal-case tracking-normal text-foreground">
                    <span className="flex items-center gap-1.5 font-medium">
                      {info.label}
                      {c.locked && <Lock className="size-3 text-subtle" aria-label="Sempre ativo" />}
                    </span>
                    <span className="block text-[12px] text-muted">{info.description}</span>
                  </Th>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-navy disabled:cursor-not-allowed"
                      checked={c.inApp}
                      disabled={c.locked}
                      onChange={() => toggle(c.category, "inApp")}
                      aria-label={`${info.label} na plataforma`}
                    />
                  </Td>
                  <Td className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-navy"
                      checked={c.email}
                      onChange={() => toggle(c.category, "email")}
                      aria-label={`${info.label} por e-mail`}
                    />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
        <div className="border-t border-line px-5 py-3">
          <Callout tone="neutral" title="Por e-mail: guardado para depois">
            Será usada quando notificações por e-mail forem ativadas. Por enquanto, nenhum e-mail de aviso é enviado — os avisos aparecem no sino e em Notificações.
          </Callout>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Resumo por e-mail" description="Consolidado das pendências para o seu perfil. Será usado quando notificações por e-mail forem ativadas." />
        <div className="px-5 py-4">
          <ChoiceCards legend="Frequência do resumo" name="digest" value={draft.digest} onChange={(digest) => setDraft((d) => ({ ...d, digest }))} options={DIGEST_OPTIONS} />
        </div>
        <PanelFooter>
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              const reset = { ...draft, categories: draft.categories.map((c) => ({ ...c, inApp: true, email: false })), digest: "NONE" as const };
              setDraft(reset);
              void save(reset);
            }}
          >
            Restaurar padrão
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={() => save()}>
            Salvar preferências
          </Button>
        </PanelFooter>
      </Panel>
    </div>
  );
}
