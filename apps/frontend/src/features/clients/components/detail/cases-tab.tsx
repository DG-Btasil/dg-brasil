"use client";

import { FolderPlus } from "lucide-react";
import type { ActionResult } from "@/lib/actions/result";
import { ActionErrorState } from "@/components/feedback/action-error";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { Page } from "@/server/core/pagination";
import type { CaseListItem } from "@/server/domain/cases/dto";
import type { Client } from "@/types";
import { CaseListTable } from "@/features/cases/components/case-list-table";
import { useDirectoryUserMap, useOrganizationNames, useOrgDirectory } from "@/features/directory/directory-context";

/** Casos do cliente (servidor). O mesmo cliente pode ter casos de origens diferentes. */
export function CasesTab({ client, cases }: { client: Client; cases: ActionResult<Page<CaseListItem>> }) {
  const users = useDirectoryUserMap();
  const names = useOrganizationNames();
  const { owner } = useOrgDirectory();
  const cta = (
    <Can permission="cases.edit">
      <ButtonLink href={`/casos/novo?cliente=${client.id}`} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );
  if (!cases.ok) return <ActionErrorState error={cases} title="Não foi possível carregar os casos do cliente." />;
  const { items, total } = cases.data;
  return (
    <Panel>
      <PanelHeader
        title="Casos do cliente"
        description={
          total > items.length
            ? `Mostrando ${items.length} de ${total}. Veja todos em Casos.`
            : "Cada caso tem origem, análise, revisões, processos e financeiro próprios."
        }
        actions={items.length > 0 ? cta : undefined}
      />
      {items.length === 0 ? (
        <EmptyState icon={FolderPlus} title="Nenhum caso para este cliente." description="Crie um caso para iniciar a análise de uma demanda." action={cta} />
      ) : (
        <CaseListTable
          rows={items}
          showClient={false}
          lawyerName={(id) => (id ? users.get(id)?.name : undefined)}
          originName={(id) => names.get(id)}
          ownerId={owner.id}
        />
      )}
    </Panel>
  );
}
