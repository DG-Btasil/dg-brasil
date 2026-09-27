"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { CLIENT_KIND_LABEL, CLIENT_KIND_SHORT, CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants/status";
import { formatEventTime } from "@/lib/formatting";
import { useRecentClients } from "../hooks";

/** Clientes atualizados mais recentemente. */
export function RecentClients() {
  const rows = useRecentClients();
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader
        title="Clientes recentes"
        description="Últimos cadastros e atualizações"
        actions={
          <ButtonLink href="/clientes" variant="secondary" size="sm">
            Ver clientes
          </ButtonLink>
        }
      />
      {rows.length === 0 ? (
        <EmptyState compact icon={Users} title="Nenhum cliente cadastrado" description="Cadastre o primeiro cliente para iniciar documentos e análises." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ client, name, responsibleName }) => (
            <li key={client.id} className="flex items-center gap-3 px-5 py-2.5">
              <Badge tone="neutral" title={CLIENT_KIND_LABEL[client.kind]} className="w-8 justify-center">
                <span aria-hidden>{CLIENT_KIND_SHORT[client.kind]}</span>
                <span className="sr-only">{CLIENT_KIND_LABEL[client.kind]}</span>
              </Badge>
              <div className="min-w-0 flex-1">
                <Link href={`/clientes/${client.id}`} className="block truncate text-[13px] font-medium text-foreground hover:text-navy-700 hover:underline underline-offset-2">
                  {name}
                </Link>
                <p className="truncate text-[11.5px] text-muted">
                  {responsibleName} · atualizado {formatEventTime(client.updatedAt)}
                </p>
              </div>
              <StatusBadge status={client.status} labels={CLIENT_STATUS_LABEL} tones={CLIENT_STATUS_TONE} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
