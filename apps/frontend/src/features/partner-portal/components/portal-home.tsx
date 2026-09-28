"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Bell, Briefcase, CircleAlert, FileClock, FileWarning, Info, UserPlus, Users } from "lucide-react";
import { now } from "@/lib/clock";
import { formatCurrency, formatEventTime, greeting } from "@/lib/formatting";
import { cn } from "@/lib/cn";
import { Can } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Stat, Timeline } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { EmptyState } from "@/components/feedback/states";
import { useCurrentPartnerOffice, useCurrentUser } from "@/features/auth/hooks";
import { usePartnerFinancialSummary } from "@/features/partners/hooks";
import { usePortalAttention, usePortalClients, usePortalProcesses, usePortalRequests, usePortalUpdates } from "../hooks";

const TONE_ICON = { warning: FileWarning, orange: CircleAlert, info: Info } as const;
const TONE_CLASS = { warning: "text-warning", orange: "text-orange", info: "text-info" } as const;

/** Início do Portal do Parceiro. */
export function PortalHome() {
  const user = useCurrentUser();
  const office = useCurrentPartnerOffice();
  const clients = usePortalClients();
  const processes = usePortalProcesses();
  const requests = usePortalRequests();
  const attention = usePortalAttention();
  const updates = usePortalUpdates(8);

  const kpis = useMemo(
    () => ({
      activeClients: clients.filter((c) => c.status !== "INACTIVE").length,
      activeProcesses: processes.filter((p) => p.status !== "CLOSED").length,
      pendingDocs: requests.filter((r) => r.status === "OPEN" && r.type === "DOCUMENT_REQUEST").length,
      recentUpdates: updates.filter((u) => now().getTime() - new Date(u.at).getTime() < 7 * 86_400_000).length,
    }),
    [clients, processes, requests, updates],
  );

  return (
    <>
      <PageHeader
        serif
        eyebrow={office?.name}
        title={`${greeting(now())}, ${user?.displayName ?? ""}`}
        description="Acompanhe os casos do seu escritório com a Bárbara Cardoso Advocacia."
        actions={
          <Can permission="partnerPortal.clients.create">
            <ButtonLink href="/clientes/novo" icon={<UserPlus className="size-4" aria-hidden />}>
              Novo cliente
            </ButtonLink>
          </Can>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Clientes ativos" value={kpis.activeClients} icon={Users} href="/clientes" />
        <Stat label="Processos ativos" value={kpis.activeProcesses} icon={Briefcase} href="/processos" />
        <Stat label="Documentos pendentes" value={kpis.pendingDocs} icon={FileClock} tone={kpis.pendingDocs ? "warning" : "neutral"} href="/pendencias" />
        <Stat label="Atualizações recentes" value={kpis.recentUpdates} icon={Bell} hint="Últimos 7 dias" href="/notificacoes" />
      </div>

      <Can permission="partnerPortal.finance.view">
        <FinanceStrip partnerOfficeId={office?.id} />
      </Can>

      <div className="mt-6 grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-7">
          <PanelHeader title="Precisa da sua atenção" description="Solicitações, cadastros incompletos e novidades dos seus casos." />
          {attention.length === 0 ? (
            <EmptyState compact icon={Info} title="Tudo em dia" description="Nenhuma pendência no momento." />
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((item) => {
                const Icon = TONE_ICON[item.tone];
                return (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3">
                    <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[item.tone])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground">{item.title}</p>
                      <p className="mt-0.5 truncate text-[12px] text-muted">{item.context}</p>
                    </div>
                    <Link href={item.href} className="shrink-0 text-[12.5px] font-semibold text-navy-700 hover:underline underline-offset-2">
                      {item.cta}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="col-span-12 xl:col-span-5">
          <PanelHeader title="Atualizações recentes" />
          <div className="px-5 py-4">
            {updates.length === 0 ? (
              <EmptyState compact title="Nenhuma atualização ainda." />
            ) : (
              <Timeline items={updates.map((u) => ({ id: u.id, title: u.description, meta: formatEventTime(u.at), description: u.actor.name }))} />
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

/** Indicador financeiro discreto (somente administrador do parceiro). */
function FinanceStrip({ partnerOfficeId }: { partnerOfficeId?: string }) {
  const summary = usePartnerFinancialSummary(partnerOfficeId);
  if (!summary) return null;
  return (
    <Link
      href="/financeiro"
      className="mt-4 flex items-center gap-8 rounded-lg border border-line bg-surface px-5 py-3 text-[12.5px] shadow-hairline transition-colors hover:border-navy-600/40"
    >
      <span className="font-medium text-foreground">Sua participação</span>
      <span className="text-muted">
        Acumulada <strong className="ml-1 font-semibold text-navy tabular">{formatCurrency(summary.accumulatedShare)}</strong>
      </span>
      <span className="text-muted">
        A receber <strong className="ml-1 font-semibold text-navy tabular">{formatCurrency(summary.toReceive)}</strong>
      </span>
      <span className="ml-auto text-[12px] font-semibold text-navy-700">Ver Financeiro</span>
    </Link>
  );
}
