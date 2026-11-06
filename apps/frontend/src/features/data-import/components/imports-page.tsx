"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileSpreadsheet, FileUp } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/display";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import type { Page } from "@/server/core/pagination";
import { listImportJobsAction } from "@/server/domain/imports/actions";
import type { ImportJobSummaryDTO } from "@/server/domain/imports/dto";
import { uploadImportFile } from "../client";
import { JOB_STATUS_LABEL, JOB_STATUS_TONE } from "../labels";

export const IMPORTS_HREF = "/configuracoes/importacoes";

/** Botão "Importar planilha": envia o arquivo e abre a importação. */
export function NewImportButton({ size = "md" }: { size?: "sm" | "md" }) {
  const router = useRouter();
  const failed = useActionFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const r = await uploadImportFile(file);
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível começar a importação.");
      return;
    }
    router.push(`${IMPORTS_HREF}/${r.data.jobId}`);
  }

  return (
    <>
      <Button size={size} icon={<FileUp className="size-4" aria-hidden />} loading={busy} onClick={() => input.current?.click()}>
        Importar planilha
      </Button>
      <input ref={input} type="file" accept=".xlsx,.csv" className="sr-only" onChange={onFile} aria-label="Planilha para importar (Excel .xlsx ou CSV)" />
    </>
  );
}

export function ImportsPage() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActionResult<Page<ImportJobSummaryDTO>> | null>(null);

  useEffect(() => {
    let alive = true;
    callAction(() => listImportJobsAction({ page, pageSize: 25 })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [page]);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumbs={[{ label: "DG Brasil", href: "/dg-brasil/integracoes" }, { label: "Importações" }]}
        title="Importação de planilhas"
        description="Traga clientes e processos de outro sistema ou de planilhas (Excel .xlsx ou CSV). Antes de gravar, o DG Brasil simula a importação, mostra o que vai acontecer linha a linha e pede sua decisão em cada conflito."
        actions={<NewImportButton />}
      />
      <Callout tone="info" title="Como funciona">
        1. Envie o arquivo · 2. Diga qual coluna é qual campo · 3. Simulação sem gravar nada · 4. Resolva os conflitos (CPF ou processo já cadastrado) · 5. Confirme e grave · 6.
        Relatório do que entrou e do que falhou. Linhas com erro nunca são gravadas.
      </Callout>
      <Panel>
        {!data ? (
          <div className="p-5">
            <SkeletonRows rows={4} />
          </div>
        ) : !data.ok ? (
          <ActionErrorState error={data} title="Não foi possível carregar as importações." />
        ) : data.data.items.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="Nenhuma importação ainda" description="Use “Importar planilha” para começar. Nada é gravado antes da sua confirmação." />
        ) : (
          <>
            <Table caption="Importações">
              <THead>
                <tr>
                  <Th>Arquivo</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Linhas</Th>
                  <Th className="text-right">Importadas</Th>
                  <Th className="text-right">Com erro</Th>
                  <Th>Iniciada por</Th>
                  <Th>Quando</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.items.map((j) => (
                  <Tr key={j.id}>
                    <Td className="max-w-[320px]">
                      <Link href={`${IMPORTS_HREF}/${j.id}`} className="font-medium text-navy-700 hover:underline">
                        {j.fileName}
                      </Link>
                      <span className="ml-2 text-[11.5px] text-subtle">{j.fileType}</span>
                    </Td>
                    <Td>
                      <Badge tone={JOB_STATUS_TONE[j.status]} dot>
                        {JOB_STATUS_LABEL[j.status]}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular">{j.totalRows !== undefined ? formatNumber(j.totalRows) : "—"}</Td>
                    <Td className="text-right tabular">{j.status === "COMPLETED" || j.status === "PROCESSING" ? formatNumber(j.successfulRows) : "—"}</Td>
                    <Td className="text-right tabular">{j.failedRows ? formatNumber(j.failedRows) : "—"}</Td>
                    <Td className="text-muted">{j.createdByName ?? "—"}</Td>
                    <Td className="whitespace-nowrap tabular text-muted">{formatDateTime(j.createdAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPageChange={setPage} noun={{ one: "importação", many: "importações" }} />
          </>
        )}
      </Panel>
    </div>
  );
}
