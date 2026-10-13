"use client";

import { FolderPlus } from "lucide-react";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import type { ProcessListItem } from "@/server/domain/processes/dto";
import { ProcessListTable } from "@/features/processes/components/process-list-table";

/** Processos do cliente (servidor). Todo processo pertence a um caso do cliente. */
export function ProcessesTab({ clientId, processes }: { clientId: string; processes: ActionResult<Page<ProcessListItem>> }) {
  const cta = (
    <Can permission="processes.edit">
      <ButtonLink href="/processos/novo" variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Cadastrar processo
      </ButtonLink>
    </Can>
  );
  if (!processes.ok) return <ActionErrorState error={processes} title="Não foi possível carregar os processos do cliente." />;
  const { items, total } = processes.data;
  return (
    <Panel>
      <PanelHeader
        title="Processos do cliente"
        description={total > items.length ? `Mostrando ${items.length} de ${total}.` : "Processos dos casos deste cliente."}
        actions={
          items.length > 0 ? (
            <ButtonLink href={`/processos?cliente=${clientId}`} variant="ghost" size="sm">
              Ver na carteira
            </ButtonLink>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={FolderPlus} title="Nenhum processo para este cliente." description="Processos são cadastrados a partir de um caso do cliente." action={cta} />
      ) : (
        <ProcessListTable rows={items} showClient={false} />
      )}
    </Panel>
  );
}
