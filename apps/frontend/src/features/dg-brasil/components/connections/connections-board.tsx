"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Bot, Cloud, Cpu, FileSearch, HardDrive, Newspaper, Scale, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { cn } from "@/lib/cn";
import { formatEventTime, formatNumber } from "@/lib/formatting";
import type { Tone } from "@/lib/constants/status";
import { usePermission } from "@/features/auth/hooks";
import type { DgOverviewDTO, OfficeStatusDTO } from "@/server/domain/dg/dto";
import type { DriveStatusDTO } from "@/server/domain/drive/dto";
import type { JudicialOverviewDTO } from "@/server/domain/judicial/dto";
import { saveTaskSettingsAction } from "@/server/domain/process-tasks/actions";
import type { TaskAgentDTO } from "@/server/domain/process-tasks/dto";
import { useToast } from "@/store/ui-store";

type Health = "ok" | "warn" | "off" | "unknown";
const DOT: Record<Health, string> = { ok: "bg-success", warn: "bg-warning", off: "bg-danger", unknown: "bg-subtle" };
const HEALTH_LABEL: Record<Health, string> = { ok: "Funcionando", warn: "Atenção", off: "Desligado / sem conexão", unknown: "Sem informação" };
const HEALTH_TONE: Record<Health, Tone> = { ok: "success", warn: "warning", off: "danger", unknown: "neutral" };

export interface ConnectionsData {
  office: ActionResult<OfficeStatusDTO>;
  judicial: ActionResult<JudicialOverviewDTO>;
  drive: ActionResult<DriveStatusDTO>;
  overview: ActionResult<DgOverviewDTO>;
  agents: ActionResult<TaskAgentDTO[]>;
}

/**
 * Central DG Brasil → Conexões (Roadmap 2.0): num lugar só, se a integração
 * do escritório está de pé — computador do escritório, esteira de agentes,
 * orquestrador das tarefas, DJEN, DataJud e Google Drive. Cada cartão leva à
 * tela onde se resolve o problema.
 */
export function ConnectionsBoard({ data }: { data: ConnectionsData }) {
  const office = data.office.ok ? data.office.data : undefined;
  const judicial = data.judicial.ok ? data.judicial.data : undefined;
  const drive = data.drive.ok ? data.drive.data : undefined;
  const overview = data.overview.ok ? data.overview.data : undefined;

  const officeHealth: Health = !office ? "unknown" : office.online ? "ok" : office.executors?.length ? "off" : "warn";
  const pipelineHealth: Health = !office ? "unknown" : !office.executionEnabled ? "off" : office.queued > 0 && !office.online ? "warn" : "ok";
  const lastRun = judicial?.runs[0];
  const monitorErrors = judicial?.monitors.filter((m) => m.active && m.lastError).length ?? 0;
  const activeOabs = judicial?.monitors.filter((m) => m.active).length ?? 0;
  const djenHealth: Health = !judicial
    ? "unknown"
    : !judicial.settings.djenEnabled
      ? "off"
      : monitorErrors > 0 || lastRun?.status === "FAILED"
        ? "warn"
        : activeOabs === 0
          ? "warn"
          : "ok";
  const datajudHealth: Health = !judicial ? "unknown" : !judicial.settings.datajudEnabled ? "off" : judicial.processes.withError > 0 ? "warn" : "ok";
  const driveHealth: Health = !drive ? "unknown" : !drive.configured ? "off" : drive.syncErrors > 0 || drive.exportsFailed > 0 ? "warn" : "ok";

  const cards = [officeHealth, pipelineHealth, djenHealth, datajudHealth, driveHealth];
  const problems = cards.filter((h) => h === "off" || h === "warn").length;

  return (
    <div className="space-y-5">
      <Panel className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className={cn("size-3 rounded-full", problems === 0 ? DOT.ok : DOT.warn)} aria-hidden />
        <p className="text-[14px] font-semibold text-foreground">
          {problems === 0 ? "Tudo conectado e funcionando." : `${problems} ${problems === 1 ? "ponto precisa" : "pontos precisam"} de atenção.`}
        </p>
        <p className="text-[12.5px] text-muted">A integração do escritório com o DG Brasil, em tempo real (atualiza ao abrir a página).</p>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card icon={Cpu} title="Computador do escritório" health={officeHealth} href="/dg-brasil/computador" action="Conectar / ver computadores">
          {office ? (
            <>
              <Line label="Situação">{office.online ? "Conectado" : "Desconectado"}</Line>
              <Line label="Último contato">{office.lastSeenAt ? formatEventTime(office.lastSeenAt) : "nunca"}</Line>
              <Line label="Computadores autorizados">{formatNumber(office.executors?.filter((e) => !e.revokedAt).length ?? 0)}</Line>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
        <Card icon={Workflow} title="Esteira de agentes" health={pipelineHealth} href="/dg-brasil/execucoes" action="Ver execuções">
          {office ? (
            <>
              <Line label="Execução pelo escritório">{office.executionEnabled ? "Ligada" : "Desligada"}</Line>
              <Line label="Na fila">{formatNumber(office.queued)}</Line>
              <Line label="Em andamento">{formatNumber(office.running)}</Line>
              {office.queued > 0 && !office.online && <p className="text-[12px] text-warning">Há trabalho na fila e nenhum computador conectado.</p>}
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
        <OrchestratorCard agents={data.agents} overview={overview} />
        <Card icon={Newspaper} title="DJEN — publicações" health={djenHealth} href="/dg-brasil/integracoes" action="Ver integração judicial">
          {judicial ? (
            <>
              <Line label="Busca diária">{judicial.settings.djenEnabled ? "Ligada" : "Desligada"}</Line>
              <Line label="OABs acompanhadas">{formatNumber(activeOabs)}</Line>
              <Line label="Última busca">{lastRun ? `${formatEventTime(lastRun.startedAt)} · ${RUN_LABEL[lastRun.status]}` : "nunca"}</Line>
              {monitorErrors > 0 && <p className="text-[12px] text-warning">{monitorErrors} OAB(s) com erro na última busca.</p>}
              <Line label="Publicações a tratar">
                <Link href="/publicacoes" className="font-medium text-navy-700 hover:underline">
                  {formatNumber(judicial.publications.pending)}
                </Link>
              </Line>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
        <Card icon={Scale} title="DataJud — andamentos" health={datajudHealth} href="/dg-brasil/integracoes" action="Ver integração judicial">
          {judicial ? (
            <>
              <Line label="Acompanhamento">{judicial.settings.datajudEnabled ? "Ligado" : "Desligado"}</Line>
              <Line label="Processos acompanhados">{formatNumber(judicial.processes.tracked)}</Line>
              <Line label="Nunca sincronizados">{formatNumber(judicial.processes.neverSynced)}</Line>
              <Line label="Com erro">{formatNumber(judicial.processes.withError)}</Line>
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
        <Card icon={HardDrive} title="Google Drive" health={driveHealth} href="/dg-brasil/integracoes" action="Ver Google Drive">
          {drive ? (
            <>
              <Line label="Conexão">{drive.configured ? (drive.mode === "service_account" ? "Conta de serviço" : "Conta Google") : "Não configurado"}</Line>
              <Line label="Clientes com pasta">{formatNumber(drive.linkedClients)}</Line>
              <Line label="Última sincronização">{drive.lastSyncAt ? formatEventTime(drive.lastSyncAt) : "nunca"}</Line>
              {(drive.syncErrors > 0 || drive.exportsFailed > 0) && <p className="text-[12px] text-warning">{drive.syncErrors + drive.exportsFailed} falha(s) de sincronização.</p>}
            </>
          ) : (
            <Unavailable />
          )}
        </Card>
      </div>
      <p className="flex items-center gap-1.5 text-[12px] text-muted">
        <Cloud className="size-3.5" aria-hidden /> Os agentes rodam no Claude Code do computador do escritório; o DG Brasil guarda a fila, as orientações e as revisões.
        <FileSearch className="ml-2 size-3.5" aria-hidden /> Detalhes técnicos em DG Brasil → Execuções.
      </p>
    </div>
  );
}

const RUN_LABEL: Record<"RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED", string> = {
  RUNNING: "em andamento",
  COMPLETED: "concluída",
  PARTIAL: "parcial",
  FAILED: "falhou",
};

function OrchestratorCard({ agents, overview }: { agents: ActionResult<TaskAgentDTO[]>; overview?: DgOverviewDTO }) {
  const canManage = usePermission("dgbrasil.manage");
  const failed = useActionFeedback();
  const toast = useToast();
  const list = agents.ok ? agents.data : [];
  const [current, setCurrent] = useState(list.find((a) => a.isOrchestrator)?.id ?? "");
  const [saving, setSaving] = useState(false);
  const health: Health = !agents.ok ? "unknown" : current ? "ok" : "warn";

  async function choose(id: string) {
    setSaving(true);
    const r = await callAction(() => saveTaskSettingsAction({ orchestratorAgentId: id || null }));
    setSaving(false);
    if (!r.ok) return failed(r, "Não foi possível salvar o orquestrador.");
    setCurrent(id);
    toast({ tone: "success", title: id ? "Orquestrador definido" : "Orquestrador removido" });
  }

  return (
    <Card icon={Bot} title="Agentes e orquestrador" health={health} href="/dg-brasil?secao=agentes" action="Ver agentes">
      {overview && <Line label="Agentes ativos">{`${formatNumber(overview.activeAgents)} de ${formatNumber(overview.totalAgents)}`}</Line>}
      <div className="pt-1">
        <p className="mb-1 text-[12px] text-muted">Orquestrador das tarefas dos processos</p>
        {canManage ? (
          <Select
            aria-label="Orquestrador das tarefas"
            value={current}
            disabled={saving || !agents.ok}
            onChange={(e) => void choose(e.target.value)}
            options={list.map((a) => ({ value: a.id, label: a.name }))}
            placeholder="Nenhum (tarefas ficam abertas)"
          />
        ) : (
          <p className="text-[13px] text-foreground">{list.find((a) => a.id === current)?.name ?? "Não definido"}</p>
        )}
        {!current && <p className="mt-1 text-[12px] text-warning">Sem orquestrador, só sai para a fila a tarefa em que a pessoa escolher o agente.</p>}
      </div>
    </Card>
  );
}

function Card({ icon: Icon, title, health, href, action, children }: { icon: typeof Bot; title: string; health: Health; href: string; action: string; children: ReactNode }) {
  return (
    <Panel className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md border border-line bg-surface-muted text-navy-700">
            <Icon className="size-4" aria-hidden />
          </span>
          <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        </div>
        <Badge tone={HEALTH_TONE[health]} dot>
          {HEALTH_LABEL[health]}
        </Badge>
      </div>
      <div className="flex-1 space-y-1.5 px-5 py-3.5 text-[13px]">{children}</div>
      <div className="border-t border-line px-5 py-2.5">
        <Link href={href} className="text-[12.5px] font-medium text-navy-700 hover:underline">
          {action} →
        </Link>
      </div>
    </Panel>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

function Unavailable() {
  return <p className="text-[12.5px] text-muted">Não foi possível ler a situação agora.</p>;
}
