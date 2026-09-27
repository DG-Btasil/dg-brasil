"use client";

import Link from "next/link";
import { FolderPlus, Hand, Plug, Workflow, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { DeadlineBadge } from "@/components/ui/display";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import {
  PROCESS_ORIGIN_DESCRIPTION,
  PROCESS_ORIGIN_LABEL,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_TONE,
  type ProcessOrigin,
} from "@/lib/constants/status";
import { formatCNJ } from "@/lib/formatting";
import { useUserMap } from "@/features/offices/hooks";
import type { Client, Process } from "@/types";
import { useNextDeadlineByProcess } from "../../hooks";

const ORIGIN_ICON: Record<ProcessOrigin, LucideIcon> = { AGENT: Workflow, INTEGRATION: Plug, MANUAL: Hand };

export function ProcessesTab({ client, processes }: { client: Client; processes: Process[] }) {
  const deadlines = useNextDeadlineByProcess(client.id);
  const users = useUserMap();
  const cta = (
    <Can permission="processes.edit">
      <ButtonLink href={`/processos/novo?cliente=${client.id}`} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );

  return (
    <Panel>
      <PanelHeader title="Processos do cliente" description="Inclui processos em pré-ajuizamento criados a partir de análises." actions={processes.length > 0 ? cta : undefined} />
      {processes.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="Nenhum processo vinculado a este cliente."
          description="Processos surgem de análises aprovadas em Revisões ou podem ser cadastrados manualmente."
          action={cta}
        />
      ) : (
        <Table caption="Processos do cliente">
          <THead>
            <tr>
              <Th>Número</Th>
              <Th>Título</Th>
              <Th>Status</Th>
              <Th>Origem</Th>
              <Th>Próximo prazo</Th>
              <Th>Responsável</Th>
            </tr>
          </THead>
          <TBody>
            {processes.map((p) => {
              const Icon = ORIGIN_ICON[p.origin];
              const deadline = deadlines.get(p.id);
              return (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/processos/${p.id}`} className="tabular font-medium text-navy-700 hover:underline underline-offset-2">
                      {p.cnj ? formatCNJ(p.cnj) : "Pré-ajuizamento"}
                    </Link>
                  </Td>
                  <Td className="max-w-[360px]">
                    <span className="block truncate">{p.title}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={p.status} labels={PROCESS_STATUS_LABEL} tones={PROCESS_STATUS_TONE} />
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-muted" title={PROCESS_ORIGIN_DESCRIPTION[p.origin]}>
                      <Icon className="size-3.5" aria-hidden />
                      {PROCESS_ORIGIN_LABEL[p.origin]}
                    </span>
                  </Td>
                  <Td>
                    {deadline ? (
                      <span className="flex flex-col gap-0.5">
                        <DeadlineBadge dueDate={deadline.dueDate} />
                        <span className="text-[11.5px] text-muted">{deadline.title}</span>
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-subtle">Sem prazo aberto</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-[12.5px]">{users.get(p.responsibleUserId)?.name ?? "—"}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Panel>
  );
}
