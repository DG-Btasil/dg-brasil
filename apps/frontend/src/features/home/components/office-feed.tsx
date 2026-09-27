"use client";

import Link from "next/link";
import { Newspaper } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Timeline } from "@/components/ui/display";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { formatEventTime } from "@/lib/formatting";
import { useOfficeFeed } from "../feed-hooks";

/** Feed cronológico do escritório: auditoria + movimentações relevantes. */
export function OfficeFeed() {
  const entries = useOfficeFeed();
  return (
    <Panel className="flex h-full flex-col">
      <PanelHeader title="Novidades" description="Acontecimentos recentes no escritório, do mais novo ao mais antigo" />
      {entries.length === 0 ? (
        <EmptyState compact icon={Newspaper} title="Sem novidades por enquanto" description="Cadastros, decisões e movimentações relevantes aparecerão aqui." />
      ) : (
        <PanelBody>
          <Timeline
            items={entries.map((e) => ({
              id: e.id,
              tone: e.source === "PROCESS" ? "gold" : "navy",
              highlight: e.source === "PROCESS",
              title: e.href ? (
                <Link href={e.href} className="hover:text-navy-700 hover:underline underline-offset-2">
                  {e.source === "PROCESS" ? `Movimentação: ${e.title}` : e.title}
                </Link>
              ) : (
                e.title
              ),
              description: e.actorName ? `${e.description} — ${e.actorName}` : e.description,
              meta: formatEventTime(e.at),
            }))}
          />
        </PanelBody>
      )}
    </Panel>
  );
}
