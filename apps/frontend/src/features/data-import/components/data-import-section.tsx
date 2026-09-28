"use client";

import { useState } from "react";
import { FileSpreadsheet, FileUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelFooter } from "@/components/ui/panel";
import { formatDateTime } from "@/lib/formatting";
import { useLastImport } from "../hooks";
import { ImportWizard } from "./import-wizard";

const IMPORTABLE = [
  "Clientes (pessoa física e jurídica)",
  "Processos e números CNJ",
  "Telefones, e-mails e endereços",
  "Responsáveis",
  "Datas e status",
  "Valores da causa",
  "Informações financeiras (referência)",
];

/** Migração de outros sistemas/planilhas para o DG Brasil. */
export function DataImportSection({ canManage }: { canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const last = useLastImport();
  return (
    <section aria-labelledby="import-title" className="space-y-3">
      <div className="flex items-start gap-3">
        <FileUp className="mt-0.5 size-4 text-navy-700" aria-hidden />
        <div>
          <h3 id="import-title" className="text-[15px] font-semibold text-foreground">
            Importação de Dados
          </h3>
          <p className="mt-0.5 text-[12.5px] text-muted">
            Para escritórios que já usam outros sistemas ou planilhas. Uma importação pode criar clientes, processos e os vínculos entre eles, com validação e prévia antes
            de gravar.
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
              <Badge tone="neutral">Outros sistemas — próxima etapa</Badge>
            </div>
            <p className="mt-3 text-[12px] text-muted">
              {last ? (
                <>
                  Última importação: <span className="tabular">{formatDateTime(last.at)}</span> por {last.actor.name}.
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
        {canManage && (
          <PanelFooter className="justify-start">
            <Button icon={<FileUp className="size-4" aria-hidden />} onClick={() => setOpen(true)}>
              Importar dados
            </Button>
            <span className="text-[12px] text-muted">Linhas com erro nunca são importadas; duplicatas exigem sua decisão.</span>
          </PanelFooter>
        )}
      </Panel>
      {canManage && <ImportWizard open={open} onClose={() => setOpen(false)} />}
    </section>
  );
}
