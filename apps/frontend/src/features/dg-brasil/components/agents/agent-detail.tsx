"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pause, Pencil, Play, Rocket } from "lucide-react";
import { Can } from "@/components/layout/guards";
import { Callout } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/display";
import { Select } from "@/components/ui/form";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TabPanel, Tabs, type TabItem } from "@/components/ui/tabs";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { AGENT_READ_TOOLS, AI_EFFORT_LABEL, AI_MODEL_LABEL } from "@/lib/constants/ai";
import { AGENT_STATUS_LABEL, AGENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useUrlTab } from "@/lib/hooks/use-url-tab";
import type { Page } from "@/server/core/pagination";
import type { AgentRunSummaryDTO } from "@/server/domain/agents/dto";
import { setDgAgentStatusAction, setDgTemplateAgentAction } from "@/server/domain/dg/actions";
import type { AgentDetailDTO, DgCatalogDTO } from "@/server/domain/dg/dto";
import { useToast } from "@/store/ui-store";
import { AgentRunsPanel } from "@/features/agent-runs/components/agent-runs-panel";
import { DEFAULT_AGENT_RUN_QUERY } from "@/features/agent-runs/list-query";
import { dgRoutes, formatVersion } from "../../utils";
import { InstructionsView, LinkedNames, VersionsList } from "../shared/bits";
import { AgentFormDrawer } from "./agent-form-drawer";
import { RunAgentDialog } from "./run-agent-dialog";

const TABS = ["visao-geral", "instrucoes", "conhecimento", "execucoes", "versoes"] as const;
type AgentTab = (typeof TABS)[number];

export function AgentDetail({ agent, catalog, runs }: { agent: AgentDetailDTO; catalog: DgCatalogDTO; runs: ActionResult<Page<AgentRunSummaryDTO>> }) {
  const [tab, setTab] = useUrlTab<AgentTab>(TABS, "visao-geral");
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const items: TabItem<AgentTab>[] = [
    { key: "visao-geral", label: "Visão geral" },
    { key: "instrucoes", label: "Instruções" },
    { key: "conhecimento", label: "Skills, teses e referências", count: agent.skillIds.length + agent.thesisIds.length + agent.referenceIds.length },
    { key: "execucoes", label: "Execuções" },
    { key: "versoes", label: "Versões", count: agent.versions.length },
  ];
  return (
    <>
      <Header agent={agent} onEdit={() => setEditing(true)} onRun={() => setRunning(true)} />
      <Tabs items={items} value={tab} onChange={setTab} label="Seções do agente" className="mb-5" />
      <TabPanel tabKey={tab}>
        {tab === "visao-geral" && <Overview agent={agent} catalog={catalog} />}
        {tab === "instrucoes" && (
          <Panel>
            <PanelHeader title={`Instruções · ${formatVersion(agent.version)}`} description="Texto usado em toda execução desta versão. Editar cria uma versão nova." />
            <PanelBody>
              <InstructionsView text={agent.instructions} />
            </PanelBody>
          </Panel>
        )}
        {tab === "conhecimento" && (
          <div className="space-y-5">
            <Panel>
              <PanelHeader title="Skills" description="Carregadas no ambiente isolado em cada execução (até 20)." />
              <PanelBody>
                <LinkedNames ids={agent.skillIds} catalog={catalog.skills} href={dgRoutes.skill} empty="Nenhuma skill vinculada." />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Teses autorizadas" description="O agente consulta só as ativas, quando precisa." />
              <PanelBody>
                <LinkedNames ids={agent.thesisIds} catalog={catalog.theses} href={dgRoutes.thesis} empty="Nenhuma tese vinculada." />
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Referências" />
              <PanelBody>
                <LinkedNames ids={agent.referenceIds} catalog={catalog.references} empty="Nenhuma referência vinculada." />
              </PanelBody>
            </Panel>
          </div>
        )}
        {tab === "execucoes" && (
          <AgentRunsPanel initialQuery={DEFAULT_AGENT_RUN_QUERY} initialResult={runs} agentId={agent.id} title="Execuções deste agente" />
        )}
        {tab === "versoes" && (
          <Panel>
            <PanelHeader title="Versões" description="Append-only. Cada execução registra a versão que usou." />
            <PanelBody>
              <VersionsList versions={agent.versions} current={agent.versionId} />
            </PanelBody>
          </Panel>
        )}
      </TabPanel>
      {editing && <AgentFormDrawer open onOpenChange={setEditing} agent={agent} catalog={catalog} />}
      {running && <RunAgentDialog agent={agent} onClose={() => setRunning(false)} />}
    </>
  );
}

function Header({ agent, onEdit, onRun }: { agent: AgentDetailDTO; onEdit: () => void; onRun: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const failed = useActionFeedback();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const pausing = agent.status === "ACTIVE";

  async function toggle() {
    setSaving(true);
    const r = await callAction(() => setDgAgentStatusAction({ id: agent.id, status: pausing ? "PAUSED" : "ACTIVE" }));
    setSaving(false);
    if (!r.ok) {
      failed(r, "Não foi possível mudar a situação do agente.");
      return;
    }
    setConfirmOpen(false);
    toast({ tone: "success", title: pausing ? `${agent.name} pausado` : `${agent.name} ativado` });
    router.refresh();
  }

  return (
    <>
      <PageHeader
        serif
        breadcrumbs={[{ label: "DG Brasil", href: dgRoutes.home }, { label: "Agentes", href: dgRoutes.home }, { label: agent.name }]}
        title={agent.name}
        description={agent.description}
        meta={
          <>
            <StatusBadge status={agent.status} labels={AGENT_STATUS_LABEL} tones={AGENT_STATUS_TONE} />
            <span>Versão {formatVersion(agent.version)}</span>
            <span>Última execução: {agent.lastRunAt ? formatEventTime(agent.lastRunAt) : "sem execuções"}</span>
          </>
        }
        actions={
          <Can permission="dgbrasil.manage">
            <div className="flex gap-2">
              <Button variant="secondary" icon={<Rocket className="size-4" aria-hidden />} onClick={onRun} disabled={agent.status !== "ACTIVE"}>
                Executar em um caso
              </Button>
              <Button variant="secondary" icon={<Pencil className="size-4" aria-hidden />} onClick={onEdit}>
                Editar
              </Button>
              <Button
                variant="secondary"
                icon={pausing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                onClick={() => setConfirmOpen(true)}
              >
                {pausing ? "Pausar agente" : "Ativar agente"}
              </Button>
            </div>
          </Can>
        }
      />
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        size="sm"
        title={pausing ? `Pausar ${agent.name}?` : `Ativar ${agent.name}?`}
        description={
          pausing
            ? "O agente deixa de receber execuções novas. O que já foi entregue continua em Revisões."
            : "O agente volta a receber execuções (se a IA estiver ligada em Configurações → IA)."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Voltar
            </Button>
            <Button onClick={toggle} loading={saving}>
              {pausing ? "Pausar agente" : "Ativar agente"}
            </Button>
          </>
        }
      />
    </>
  );
}

function Overview({ agent, catalog }: { agent: AgentDetailDTO; catalog: DgCatalogDTO }) {
  const c = agent.config;
  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader title="Configuração de execução" />
        <PanelBody>
          <DefinitionGrid
            columns={4}
            items={[
              { label: "Modelo", value: AI_MODEL_LABEL[c.model] ?? c.model },
              { label: "Esforço", value: AI_EFFORT_LABEL[c.effort] },
              { label: "Ambiente isolado", value: c.codeExecution ? "Ligado" : "Desligado" },
              { label: "Teto de custo", value: `US$ ${c.maxBudgetUsd.toFixed(2)}` },
              { label: "Passos (máx.)", value: String(c.maxTurns) },
              { label: "Chamadas de ferramenta", value: String(c.maxToolCalls) },
              { label: "Tempo máximo", value: `${Math.round(c.maxDurationSeconds / 60)} min` },
              {
                label: "Ferramentas de leitura",
                value: c.tools.length ? c.tools.map((t) => AGENT_READ_TOOLS.find((x) => x.id === t)?.label ?? t).join(", ") : "Todas",
              },
              { label: "Objetivo", value: agent.purpose, wide: true },
            ]}
          />
        </PanelBody>
      </Panel>
      <TemplatesPanel agent={agent} catalog={catalog} />
    </div>
  );
}

/** Templates de análise que este agente executa (analysis_templates.primary_agent_id). */
function TemplatesPanel({ agent, catalog }: { agent: AgentDetailDTO; catalog: DgCatalogDTO }) {
  const router = useRouter();
  const failed = useActionFeedback();
  const [busy, setBusy] = useState(false);
  const available = catalog.templates.filter((t) => t.active && t.agentId !== agent.id);

  async function setAgent(templateId: string, agentId: string | null) {
    setBusy(true);
    const r = await callAction(() => setDgTemplateAgentAction({ templateId, agentId }));
    setBusy(false);
    if (!r.ok) failed(r, "Não foi possível alterar o template.");
    else router.refresh();
  }

  return (
    <Panel>
      <PanelHeader title="Análises executadas por este agente" description="Quando um advogado envia uma análise deste modelo, é este agente que a executa." />
      <PanelBody className="space-y-3">
        {agent.templates.length === 0 ? (
          <p className="text-[13px] text-muted">Nenhum modelo de análise usa este agente.</p>
        ) : (
          <ul className="space-y-1.5">
            {agent.templates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="font-medium text-foreground">{t.name}</span>
                <Can permission="dgbrasil.manage">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAgent(t.id, null)}>
                    Desvincular
                  </Button>
                </Can>
              </li>
            ))}
          </ul>
        )}
        <Can permission="dgbrasil.manage">
          {available.length > 0 && (
            <Select
              aria-label="Usar este agente em um modelo de análise"
              placeholder="Usar em um modelo de análise…"
              options={available.map((t) => ({ value: t.id, label: `${t.name} · ${t.legalAreaName}${t.agentId ? " (troca o agente atual)" : ""}` }))}
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && setAgent(e.target.value, agent.id)}
              className="max-w-[440px]"
            />
          )}
          {agent.status !== "ACTIVE" && agent.templates.length > 0 && (
            <Callout tone="warning">Este agente não está ativo: as análises desses modelos ficam sem executar.</Callout>
          )}
        </Can>
      </PanelBody>
    </Panel>
  );
}
