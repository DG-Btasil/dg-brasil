"use client";

import Link from "next/link";
import { Briefcase, CheckCircle2, FolderPlus, Hourglass, Inbox, Info } from "lucide-react";
import { now } from "@/lib/clock";
import { LEGAL_CASE_STATUS_TONE, PARTNER_CASE_STATUS_LABEL, PARTNER_REQUEST_TYPE_LABEL, PROCESS_STATUS_LABEL, PROCESS_STATUS_TONE } from "@/lib/constants/status";
import { formatCurrency, formatEventTime, greeting } from "@/lib/formatting";
import { Can } from "@/components/layout/guards";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, Stat } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { PartnerHomeData } from "@/features/home/load";

/**
 * Início do Portal do Parceiro, com dados do SERVIDOR (RLS recorta ao
 * escritório da sessão): casos em análise e ativos, solicitações abertas,
 * casos e processos recentes e — só PARTNER_ADMIN — a participação.
 */
export function PortalHome({ data }: { data: PartnerHomeData }) {
  const open = data.openRequests.ok ? data.openRequests.data.total : undefined;
  return (
    <>
      <PageHeader
        serif
        eyebrow={data.officeName}
        title={`${greeting(now())}, ${data.firstName}`}
        description="Acompanhe os casos do seu escritório com a Bárbara Cardoso Advocacia."
        actions={
          <Can permission="partnerPortal.cases.create">
            <ButtonLink href="/casos/novo" icon={<FolderPlus className="size-4" aria-hidden />}>
              Novo caso
            </ButtonLink>
          </Can>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Casos em análise" value={data.inAnalysis ?? "—"} icon={Hourglass} href="/casos?situacao=Em%20an%C3%A1lise" />
        <Stat label="Casos aceitos e em andamento" value={data.activeCases ?? "—"} icon={CheckCircle2} href="/casos" />
        <Stat label="Solicitações abertas" value={open ?? "—"} icon={Inbox} tone={open ? "warning" : "neutral"} href="/pendencias" />
      </div>

      {data.finance?.ok && (
        <Link
          href="/financeiro"
          className="mt-4 flex items-center gap-8 rounded-lg border border-line bg-surface px-5 py-3 text-[12.5px] shadow-hairline transition-colors hover:border-navy-600/40"
        >
          <span className="font-medium text-foreground">Sua participação</span>
          <span className="text-muted">
            Acumulada <strong className="ml-1 font-semibold text-navy tabular">{formatCurrency(data.finance.data.totals.accruedAmount)}</strong>
          </span>
          <span className="text-muted">
            Disponível <strong className="ml-1 font-semibold text-navy tabular">{formatCurrency(data.finance.data.totals.availableAmount)}</strong>
          </span>
          <span className="ml-auto text-[12px] font-semibold text-navy-700">Ver Financeiro</span>
        </Link>
      )}

      <div className="mt-6 grid grid-cols-12 gap-5">
        <Panel className="col-span-12 xl:col-span-7">
          <PanelHeader title="Precisa da sua atenção" description="Solicitações da Bárbara Cardoso Advocacia aguardando o seu escritório." />
          {!data.openRequests.ok ? (
            <ActionErrorState error={data.openRequests} title="Não foi possível carregar as solicitações." />
          ) : data.openRequests.data.items.length === 0 ? (
            <EmptyState compact icon={Info} title="Tudo em dia" description="Nenhuma solicitação aberta no momento." />
          ) : (
            <ul className="divide-y divide-line">
              {data.openRequests.data.items.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-5 py-3">
                  <Inbox className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{r.title}</p>
                    <p className="mt-0.5 truncate text-[12px] text-muted">
                      {(PARTNER_REQUEST_TYPE_LABEL as Record<string, string>)[r.type] ?? "Solicitação"}
                      {r.caseTitle ? ` · ${r.caseTitle}` : ""} · {formatEventTime(r.createdAt)}
                    </p>
                  </div>
                  <Link href="/pendencias" className="shrink-0 text-[12.5px] font-semibold text-navy-700 hover:underline underline-offset-2">
                    Responder
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="col-span-12 xl:col-span-5">
          <PanelHeader title="Casos recentes" actions={<ButtonLink href="/casos" variant="secondary" size="sm">Ver casos</ButtonLink>} />
          {!data.recentCases.ok ? (
            <ActionErrorState error={data.recentCases} title="Não foi possível carregar os casos." />
          ) : data.recentCases.data.items.length === 0 ? (
            <EmptyState compact title="Nenhum caso ainda." />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentCases.data.items.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/casos/${c.id}`} className="block truncate text-[13px] font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                      {c.title}
                    </Link>
                    <p className="truncate text-[11.5px] text-muted">
                      {c.clientName || "—"} · {formatEventTime(c.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={c.status} labels={PARTNER_CASE_STATUS_LABEL} tones={LEGAL_CASE_STATUS_TONE} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="col-span-12">
          <PanelHeader title="Processos com atualização recente" actions={<ButtonLink href="/processos" variant="secondary" size="sm">Ver processos</ButtonLink>} />
          {!data.recentProcesses.ok ? (
            <ActionErrorState error={data.recentProcesses} title="Não foi possível carregar os processos." />
          ) : data.recentProcesses.data.items.length === 0 ? (
            <EmptyState compact icon={Briefcase} title="Nenhum processo ainda." />
          ) : (
            <ul className="divide-y divide-line">
              {data.recentProcesses.data.items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link href={`/processos/${p.id}`} className="block truncate text-[13px] font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                      {p.title}
                    </Link>
                    <p className="truncate text-[11.5px] text-muted">
                      {p.caseTitle} · {formatEventTime(p.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
