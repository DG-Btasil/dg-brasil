"use client";

import { useMemo } from "react";
import { FolderPlus } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { Can } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useCaseRows } from "@/features/cases/hooks";
import { CaseTable } from "@/features/cases/components/case-table";
import type { Client } from "@/types";

/** Casos do cliente. O mesmo cliente pode ter casos de origens diferentes. */
export function CasesTab({ client }: { client: Client }) {
  const all = useCaseRows();
  const rows = useMemo(() => all.filter((r) => r.legalCase.clientId === client.id), [all, client.id]);
  const cta = (
    <Can permission="cases.edit">
      <ButtonLink href={`/casos/novo?cliente=${client.id}`} variant="secondary" size="sm" icon={<FolderPlus className="size-4" aria-hidden />}>
        Novo caso
      </ButtonLink>
    </Can>
  );
  return (
    <Panel>
      <PanelHeader title="Casos do cliente" description="Cada caso tem origem, análise, revisões, processos e financeiro próprios." actions={rows.length > 0 ? cta : undefined} />
      {rows.length === 0 ? (
        <EmptyState icon={FolderPlus} title="Nenhum caso para este cliente." description="Crie um caso para iniciar a análise de uma demanda." action={cta} />
      ) : (
        <CaseTable rows={rows} />
      )}
    </Panel>
  );
}
