"use client";

import { useCallback, useEffect, useState } from "react";
import { Newspaper, Plus } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { getMyJudicialMonitorsAction, setJudicialMonitorActiveAction } from "@/server/domain/judicial/actions";
import type { JudicialMonitorDTO, MyJudicialMonitorsDTO } from "@/server/domain/judicial/dto";
import { CoverageDialog } from "./coverage-dialog";
import { useToast } from "@/store/ui-store";
import { AddMonitorDialog, MonitorTable, monitorToggledToast } from "./judicial-settings-panel";

/**
 * Portal do parceiro → Minha Conta (043): as OABs do PRÓPRIO escritório que o
 * DG Brasil acompanha no DJEN. O administrador do parceiro cadastra e pausa;
 * os demais usuários veem. As publicações entram só nos processos que o
 * escritório já tem no DG Brasil.
 */
export function PartnerOabsPanel() {
  const failed = useActionFeedback();
  const toast = useToast();
  const [toggling, setToggling] = useState<string | null>(null);
  const [data, setData] = useState<ActionResult<MyJudicialMonitorsDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [coverage, setCoverage] = useState<JudicialMonitorDTO | null>(null);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => getMyJudicialMonitorsAction()).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [version]);

  async function toggle(m: JudicialMonitorDTO) {
    if (toggling) return;
    setToggling(m.id);
    const r = await callAction(() => setJudicialMonitorActiveAction({ id: m.id, active: !m.active }));
    setToggling(null);
    if (!r.ok) return failed(r, "Não foi possível alterar a OAB.");
    toast(monitorToggledToast(m));
    reload();
  }

  if (!data) return <SkeletonRows rows={2} />;
  if (!data.ok) return <ActionErrorState error={data} title="Não foi possível ler as OABs acompanhadas." />;
  const d = data.data;

  return (
    <Panel>
      <PanelHeader
        title="OABs acompanhadas"
        description="O DG Brasil busca todo dia, de manhã, as publicações do DJEN destas OABs e as coloca nos processos do seu escritório já cadastrados aqui. De processo que não está no DG Brasil nada é guardado, nem o número."
        actions={
          d.canManage && (
            <Button size="sm" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
              Adicionar OAB
            </Button>
          )
        }
      />
      {d.monitors.length === 0 ? (
        <EmptyState compact icon={Newspaper} title="Nenhuma OAB acompanhada." description={d.canManage ? "Cadastre a OAB de cada advogado do escritório." : "O administrador do escritório cadastra as OABs."} />
      ) : (
        <MonitorTable rows={d.monitors} canManage={d.canManage} onToggle={toggle} onCoverage={setCoverage} showOrganization={false} busyId={toggling} />
      )}
      {adding && <AddMonitorDialog partner onClose={() => setAdding(false)} onSaved={reload} />}
      {coverage && <CoverageDialog monitor={coverage} onClose={() => setCoverage(null)} />}
    </Panel>
  );
}
