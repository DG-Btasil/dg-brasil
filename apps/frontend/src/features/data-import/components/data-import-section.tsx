"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, FileSpreadsheet, FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { usePermission } from "@/features/auth/hooks";
import { callAction } from "@/lib/actions/result";
import { formatDateTime } from "@/lib/formatting";
import { listImportJobsAction } from "@/server/domain/imports/actions";
import type { ImportJobSummaryDTO } from "@/server/domain/imports/dto";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "../labels";
import { IMPORTS_HREF, NewImportButton } from "./imports-page";

const IMPORTABLE = [
  "Clientes (pessoa física e jurídica)",
  "Telefone, e-mail e endereço",
  "Processos (número CNJ, vara, parte contrária…)",
  "Caso de cada processo, já em andamento",
  "Responsável pelo cliente e pelo processo",
  "Próximo vencimento, como prazo",
];

/** Configurações → Integrações: atalho para a importação de planilhas (real, Etapa 7). */
export function DataImportSection() {
  const canImport = usePermission("imports.manage");
  const [last, setLast] = useState<ImportJobSummaryDTO | null | undefined>(undefined);

  useEffect(() => {
    if (!canImport) return;
    let alive = true;
    callAction(() => listImportJobsAction({ page: 1, pageSize: 1 })).then((r) => alive && setLast(r.ok ? (r.data.items[0] ?? null) : null));
    return () => {
      alive = false;
    };
  }, [canImport]);

  return (
    <section aria-labelledby="import-title" className="space-y-3">
      <div className="flex items-start gap-3">
        <FileUp className="mt-0.5 size-4 text-navy-700" aria-hidden />
        <div>
          <h3 id="import-title" className="text-[15px] font-semibold text-foreground">
            Importação de planilhas
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Para trazer clientes e processos de outro sistema ou de planilhas. Simulação antes de gravar, decisão em cada conflito e relatório do que entrou e do que falhou.
          </p>
        </div>
      </div>
      <Panel>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-6 px-5 py-4">
          <div>
            <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">Formatos</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="navy" icon={<FileSpreadsheet className="size-3" aria-hidden />}>
                Excel (.xlsx)
              </Badge>
              <Badge tone="navy" icon={<FileSpreadsheet className="size-3" aria-hidden />}>
                CSV
              </Badge>
              <Badge tone="neutral">até 5.000 linhas · 20 MB</Badge>
            </div>
            <p className="mt-3 text-[12px] text-muted">
              {!canImport ? (
                "Só o administrador importa planilhas."
              ) : last === undefined ? (
                "Carregando…"
              ) : last ? (
                <>
                  Última:{" "}
                  <Link href={`${IMPORTS_HREF}/${last.id}`} className="text-navy-700 hover:underline">
                    {last.fileName}
                  </Link>{" "}
                  · <Badge tone={JOB_STATUS_TONE[last.status]}>{JOB_STATUS_LABEL[last.status]}</Badge> · <span className="tabular">{formatDateTime(last.createdAt)}</span>
                </>
              ) : (
                "Nenhuma importação realizada ainda."
              )}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-subtle">O que pode ser importado</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] text-foreground">
              {IMPORTABLE.map((i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-gold" />
                  {i}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {canImport && (
          <PanelFooter className="justify-start">
            <NewImportButton size="sm" />
            <ButtonLink href={IMPORTS_HREF} variant="ghost" size="sm" icon={<ArrowRight className="size-3.5" aria-hidden />}>
              Ver importações
            </ButtonLink>
            <span className="text-[12px] text-muted">Linhas com erro nunca são gravadas; duplicatas exigem sua decisão.</span>
          </PanelFooter>
        )}
      </Panel>
    </section>
  );
}
