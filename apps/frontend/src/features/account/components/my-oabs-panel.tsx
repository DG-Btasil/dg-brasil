"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Plus, Star, Trash2 } from "lucide-react";
import { SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/form";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { OAB_UF_OPTIONS, formatOab, normalizeOab } from "@/lib/auth/oab";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { addMyOabAction, listMyOabsAction, removeMyOabAction, setMyPrimaryOabAction } from "@/server/domain/account/actions";
import type { MyOabDTO } from "@/server/domain/account/oabs";
import { useToast } from "@/store/ui-store";

/**
 * Minhas OABs (Roadmap 2.0): uma linha por seccional. A principal aparece no
 * perfil e nas peças; as outras ficam registradas para quem atua em vários
 * estados. Cada pessoa cuida só das próprias.
 */
export function MyOabsPanel() {
  const failed = useActionFeedback();
  const toast = useToast();
  const [result, setResult] = useState<ActionResult<MyOabDTO[]> | null>(null);
  const [number, setNumber] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MyOabDTO | null>(null);

  const [version, setVersion] = useState(0);
  const load = () => setVersion((v) => v + 1);
  useEffect(() => {
    let alive = true;
    void callAction(() => listMyOabsAction()).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [version]);

  async function add() {
    const oab = normalizeOab({ number, state });
    if (!oab || oab === "invalid") return setError("Informe o número da OAB (só números) e a UF.");
    setError(undefined);
    setBusy("add");
    const r = await callAction(() => addMyOabAction({ number: oab.number, state: oab.state }));
    setBusy(null);
    if (!r.ok) return failed(r, "Não foi possível cadastrar a OAB.");
    setNumber("");
    setState("");
    toast({ tone: "success", title: "OAB cadastrada", description: formatOab(oab.number, oab.state) });
    load();
  }

  async function makePrimary(oab: MyOabDTO) {
    setBusy(oab.id);
    const r = await callAction(() => setMyPrimaryOabAction({ id: oab.id }));
    setBusy(null);
    if (!r.ok) return failed(r, "Não foi possível atualizar a OAB.");
    toast({ tone: "success", title: "OAB principal atualizada", description: formatOab(oab.number, oab.state) });
    load();
  }

  /** Chamado pela confirmação: devolve `false` para o diálogo continuar aberto quando falha. */
  async function remove(oab: MyOabDTO): Promise<boolean> {
    const r = await callAction(() => removeMyOabAction({ id: oab.id }));
    if (!r.ok) {
      failed(r, "Não foi possível remover a OAB.");
      return false;
    }
    toast({ tone: "success", title: "OAB removida", description: formatOab(oab.number, oab.state) });
    load();
    return true;
  }

  const list = result?.ok ? result.data : [];
  return (
    <Panel>
      <PanelHeader title="Minhas OABs" description="Cadastre todas as suas inscrições (uma por seccional). A principal aparece no seu perfil." />
      <div className="space-y-4 px-5 py-4">
        {!result ? (
          <SkeletonRows rows={2} />
        ) : !result.ok ? (
          <p className="text-[13px] text-danger">Não foi possível carregar as OABs.</p>
        ) : list.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhuma OAB cadastrada.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {list.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <BadgeCheck className="size-4 text-navy-700" aria-hidden />
                <span className="text-[13.5px] font-medium tabular text-foreground">{formatOab(o.number, o.state)}</span>
                {o.isPrimary && <Badge tone="gold">Principal</Badge>}
                <span className="ml-auto flex gap-1">
                  {!o.isPrimary && (
                    <Button size="sm" variant="ghost" icon={<Star className="size-3.5" aria-hidden />} loading={busy === o.id} disabled={!!busy} onClick={() => makePrimary(o)}>
                      Tornar principal
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" aria-hidden />} disabled={!!busy} onClick={() => setRemoving(o)}>
                    Remover
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[minmax(0,220px)_96px_auto] items-end gap-3">
          <Field label="Número da OAB" requirement="optional" error={error}>
            {(p) => <Input {...p} inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="000000" />}
          </Field>
          <Field label="UF" requirement="optional">
            {(p) => <Select {...p} placeholder="—" options={OAB_UF_OPTIONS} value={state} onChange={(e) => setState(e.target.value)} />}
          </Field>
          <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} loading={busy === "add"} disabled={!!busy && busy !== "add"} onClick={add} className="mb-[1px]">
            Adicionar OAB
          </Button>
        </div>
      </div>
      {removing && (
        <ConfirmDialog
          title="Remover esta OAB?"
          description={`A inscrição ${formatOab(removing.number, removing.state)} sai do seu cadastro. Você pode cadastrar de novo quando quiser.`}
          confirmLabel="Remover OAB"
          tone="danger"
          icon={<Trash2 className="size-4" aria-hidden />}
          onConfirm={() => remove(removing)}
          onClose={() => setRemoving(null)}
        >
          {removing.isPrimary && <p className="text-[13px] text-muted">Esta é a sua OAB principal, a que aparece no seu perfil.</p>}
        </ConfirmDialog>
      )}
    </Panel>
  );
}
