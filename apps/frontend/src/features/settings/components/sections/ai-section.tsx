"use client";

import { useCallback, useEffect, useState } from "react";
import { Power, PowerOff } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { AI_MODEL_LABEL } from "@/lib/constants/ai";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import { DailyUsageChart, RunsByAgentChart, UsageByModelTable } from "@/features/integrations/components/ai/ai-usage-charts";
import { getAiStatusAction, getAiUsageAction, setAiEnabledAction } from "@/server/domain/dg/actions";
import type { AiRuntimeStatusDTO, AiUsageDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { SectionHeader } from "../section-header";

/**
 * IA e uso (dados reais, 039): o interruptor geral da execução de IA e o uso
 * dos agentes (execuções, tokens e custo estimado). Ligar/desligar é do ADMIN
 * e fica auditado. A chave do provedor nunca aparece aqui: fica só no worker.
 */
export function AiSection() {
  const isAdmin = usePermission("dgbrasil.manage");
  const [status, setStatus] = useState<ActionResult<AiRuntimeStatusDTO> | null>(null);
  const [usage, setUsage] = useState<ActionResult<AiUsageDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true;
    Promise.all([callAction(() => getAiStatusAction()), isAdmin ? callAction(() => getAiUsageAction({ days: 30 })) : Promise.resolve(null)]).then(([s, u]) => {
      if (!alive) return;
      setStatus(s);
      setUsage(u);
    });
    return () => {
      alive = false;
    };
  }, [isAdmin, version]);

  return (
    <div className="space-y-5">
      <SectionHeader title="IA e uso" description="Interruptor geral da execução dos agentes e o consumo dos últimos 30 dias." />
      {!status ? <SkeletonRows rows={3} /> : !status.ok ? <ActionErrorState error={status} title="Não foi possível ler a situação da IA." /> : <KillSwitch status={status.data} canToggle={isAdmin} onChanged={load} />}
      {isAdmin && (!usage ? <SkeletonRows rows={4} /> : !usage.ok ? <ActionErrorState error={usage} title="Não foi possível carregar o uso." /> : <Usage u={usage.data} />)}
    </div>
  );
}

function KillSwitch({ status, canToggle, onChanged }: { status: AiRuntimeStatusDTO; canToggle: boolean; onChanged: () => void }) {
  const toast = useToast();
  const failed = useActionFeedback();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const on = status.executionEnabled;

  async function toggle() {
    setSaving(true);
    const r = await callAction(() => setAiEnabledAction({ enabled: !on, reason: reason || undefined }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível mudar a execução de IA.");
      return;
    }
    setOpen(false);
    setReason("");
    toast({ tone: on ? "warning" : "success", title: on ? "Execução de IA desligada" : "Execução de IA ligada", description: on ? "Nenhuma execução nova começa; as pedidas ficam na fila." : "O worker volta a processar a fila (se também estiver ligado no servidor)." });
    onChanged();
  }

  return (
    <Panel>
      <PanelHeader
        title="Execução de IA"
        description="Duas chaves precisam estar ligadas: esta (do escritório) e a do servidor do worker. Com qualquer uma desligada, nada é executado."
        actions={<Badge tone={on ? "success" : "danger"}>{on ? "Ligada" : "Desligada"}</Badge>}
      />
      <PanelBody className="space-y-3">
        <DefinitionGrid
          columns={3}
          items={[
            { label: "Situação", value: on ? "Execuções novas são processadas" : "Execuções ficam na fila, sem rodar" },
            { label: "Última mudança", value: status.updatedAt ? `${formatDateTime(status.updatedAt)}${status.updatedByName ? ` · ${status.updatedByName}` : ""}` : "—" },
            { label: "Motivo", value: status.reason },
          ]}
        />
        {canToggle ? (
          <Button variant={on ? "danger" : "primary"} icon={on ? <PowerOff className="size-4" aria-hidden /> : <Power className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
            {on ? "Desligar a execução de IA" : "Ligar a execução de IA"}
          </Button>
        ) : (
          <p className="text-[12.5px] text-muted">Só o administrador liga ou desliga.</p>
        )}
      </PanelBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="sm"
        title={on ? "Desligar a execução de IA?" : "Ligar a execução de IA?"}
        description={
          on
            ? "Nenhuma execução nova começa. A que estiver rodando termina; as pedidas ficam na fila até religar."
            : "O worker passa a processar a fila (com custo no provedor). Use dados fictícios até a revisão LGPD."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button variant={on ? "danger" : "primary"} loading={saving} onClick={toggle}>
              {on ? "Desligar" : "Ligar"}
            </Button>
          </>
        }
      >
        <Field label="Motivo" requirement="optional">
          {(a) => <Input {...a} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: teste controlado no DEV" />}
        </Field>
      </Dialog>
    </Panel>
  );
}

function Usage({ u }: { u: AiUsageDTO }) {
  const t = u.totals;
  const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  return (
    <>
      <Panel>
        <PanelHeader title="Uso nos últimos 30 dias" description="Custo ESTIMADO pelos tokens (tabela pública do provedor). Não inclui as horas do ambiente isolado." />
        <PanelBody>
          <DefinitionGrid
            columns={4}
            items={[
              { label: "Execuções", value: formatNumber(t.runs) },
              { label: "Concluídas / aguardando humano", value: `${formatNumber(t.completed)} / ${formatNumber(t.waitingHuman)}` },
              { label: "Falharam / interrompidas", value: `${formatNumber(t.failed)} / ${formatNumber(t.cancelled)}` },
              { label: "Na fila ou rodando", value: formatNumber(t.active) },
              { label: "Tokens de entrada", value: formatNumber(t.inputTokens) },
              { label: "Tokens de saída", value: formatNumber(t.outputTokens) },
              { label: "Custo estimado", value: usd(t.estimatedCost) },
            ]}
          />
        </PanelBody>
      </Panel>
      {t.runs === 0 ? (
        <Callout tone="neutral">Nenhuma execução no período.</Callout>
      ) : (
        <>
          <DailyUsageChart daily={u.byDay.map((d) => ({ date: d.key, runs: d.runs, inputTokens: d.inputTokens, outputTokens: d.outputTokens, costUsd: d.estimatedCost }))} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <RunsByAgentChart data={[...u.byAgent].sort((a, b) => b.runs - a.runs).map((a) => ({ name: a.label, runs: a.runs }))} />
            <UsageByModelTable byModel={u.byModel.map((m) => ({ model: AI_MODEL_LABEL[m.key] ?? m.key, runs: m.runs, tokens: m.inputTokens + m.outputTokens, costUsd: m.estimatedCost }))} />
          </div>
          <Panel>
            <PanelHeader title="Custo por agente" as="h3" />
            <Table caption="Custo por agente">
              <THead>
                <tr>
                  <Th>Agente</Th>
                  <Th className="text-right">Execuções</Th>
                  <Th className="text-right">Falhas</Th>
                  <Th className="text-right">Tokens</Th>
                  <Th className="text-right">Custo estimado</Th>
                </tr>
              </THead>
              <TBody>
                {u.byAgent.map((a) => (
                  <Tr key={a.key}>
                    <Td className="font-medium text-foreground">{a.label}</Td>
                    <Td className="text-right tabular">{formatNumber(a.runs)}</Td>
                    <Td className="text-right tabular">{formatNumber(a.failed ?? 0)}</Td>
                    <Td className="text-right tabular">{formatNumber(a.inputTokens + a.outputTokens)}</Td>
                    <Td className="text-right tabular">{usd(a.estimatedCost)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </Panel>
        </>
      )}
    </>
  );
}
