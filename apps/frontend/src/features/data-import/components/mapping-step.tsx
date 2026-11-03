"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Callout } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { FIELD_BY_KEY, IMPORT_ENTITY_LABEL, IMPORT_FIELDS, fieldLabel, mapsProcess, type ImportFieldKey } from "@/lib/domain/import-fields";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import type { ColumnsDTO, ImportJobDTO, ImportReferenceDTO } from "@/server/domain/imports/dto";
import { JOB_STATUS_LABEL } from "../labels";

const fieldOptions = IMPORT_FIELDS.map((f) => ({ value: f.key, label: `${IMPORT_ENTITY_LABEL[f.entity]} → ${f.label}${f.required ? " *" : ""}` }));

export interface MappingSubmit {
  mapping: { sourceColumn: string; targetField: ImportFieldKey }[];
  options: { legalAreaId?: string; lawyerId?: string };
}

/** Problemas que impedem simular (o servidor e o banco conferem de novo). */
export function mappingProblems(mapping: Record<string, ImportFieldKey | "">, options: MappingSubmit["options"]): string[] {
  const targets = Object.values(mapping).filter(Boolean) as ImportFieldKey[];
  const out: string[] = [];
  const dup = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dup.length) out.push(`${fieldLabel(dup[0]!)} está em mais de uma coluna: cada campo recebe uma coluna só.`);
  if (!targets.includes("client.name")) out.push("Escolha a coluna do nome do cliente (obrigatória).");
  if (!targets.includes("client.document") && !mapsProcess(targets)) out.push("Escolha a coluna do CPF/CNPJ: sem ela só dá para importar processos de clientes já cadastrados.");
  if (mapsProcess(targets)) {
    if (!targets.some((t) => t === "process.cnj" || t === "process.title" || t === "process.actionType")) out.push("Para importar processos, escolha a coluna do número CNJ, do nome ou do tipo de ação.");
    if (!options.legalAreaId) out.push("Escolha a área jurídica dos casos que serão criados.");
    if (!options.lawyerId) out.push("Escolha o advogado responsável padrão.");
  }
  return out;
}

export function MappingStep({
  job,
  columns,
  reference,
  busy,
  onChangeSheet,
  onSubmit,
}: {
  job: ImportJobDTO;
  columns: ColumnsDTO;
  reference: ImportReferenceDTO;
  busy: boolean;
  onChangeSheet: (sheet: string) => void;
  onSubmit: (value: MappingSubmit) => void;
}) {
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey | "">>(() => {
    if (job.mapping.length) {
      const saved = Object.fromEntries(job.mapping.map((m) => [m.sourceColumn, m.targetField]));
      return Object.fromEntries(columns.headers.map((h) => [h, (saved[h] as ImportFieldKey | undefined) ?? ""]));
    }
    return columns.suggestedMapping;
  });
  const [areaId, setAreaId] = useState(job.options.legalAreaId ?? reference.areas.find((a) => a.code === "BANKING")?.id ?? "");
  const [lawyerId, setLawyerId] = useState(job.options.lawyerId ?? "");
  const options = { legalAreaId: areaId || undefined, lawyerId: lawyerId || undefined };
  const problems = mappingProblems(mapping, options);
  const hasProcess = mapsProcess(Object.values(mapping).filter(Boolean));
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    Object.values(mapping).forEach((f) => f && m.set(f, (m.get(f) ?? 0) + 1));
    return m;
  }, [mapping]);
  const lawyers = reference.users.filter((u) => u.role === "ADMIN" || u.role === "LAWYER");
  const examples = (i: number) =>
    columns.preview
      .map((r) => r.cells[i])
      .filter(Boolean)
      .slice(0, 3);

  return (
    <div className="space-y-5">
      {columns.sameFileJobs.length > 0 && (
        <Callout tone="warning" title="Este mesmo arquivo já foi enviado antes">
          {columns.sameFileJobs.map((j) => `${j.fileName} (${JOB_STATUS_LABEL[j.status].toLowerCase()}, ${formatDateTime(j.createdAt)})`).join("; ")}. Se ele já foi importado, uma nova
          importação vai encontrar os clientes e processos como “já cadastrados” e pedir sua decisão.
        </Callout>
      )}

      <Panel>
        <PanelHeader
          title="Qual coluna é qual campo"
          description={`${formatNumber(columns.totalRows)} linhas de dados e ${columns.headers.length} colunas${columns.sheetName ? ` na aba “${columns.sheetName}”` : ""}, cabeçalho na linha ${columns.headerLine}. Sugerimos o campo pelo nome da coluna: confira. Coluna sem campo é ignorada.`}
          actions={
            columns.sheets.length > 1 ? (
              <div className="w-[220px]">
                <Select
                  aria-label="Aba da planilha"
                  value={columns.sheetName ?? ""}
                  onChange={(e) => onChangeSheet(e.target.value)}
                  options={columns.sheets.map((s) => ({ value: s, label: `Aba: ${s}` }))}
                  disabled={busy}
                />
              </div>
            ) : undefined
          }
        />
        <Table caption="Mapeamento de colunas">
          <THead>
            <tr>
              <Th>Coluna do arquivo</Th>
              <Th>Exemplos</Th>
              <Th>Campo no DG Brasil</Th>
            </tr>
          </THead>
          <TBody>
            {columns.headers.map((h, i) => {
              const field = mapping[h] ?? "";
              const duplicate = field && (counts.get(field) ?? 0) > 1;
              const hint = field ? FIELD_BY_KEY.get(field)?.hint : undefined;
              return (
                <Tr key={h}>
                  <Td className="font-medium text-foreground">{h}</Td>
                  <Td className="max-w-[260px] text-[12px] text-muted">
                    {examples(i).length ? examples(i).map((x, k) => <span key={k} className="block truncate">{x}</span>) : <span className="text-subtle">vazio nas primeiras linhas</span>}
                  </Td>
                  <Td className="w-[380px]">
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label={`Campo do DG Brasil para a coluna ${h}`}
                        value={field}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as ImportFieldKey | "" }))}
                        options={fieldOptions}
                        placeholder="Não importar"
                        disabled={busy}
                      />
                      {field && field === columns.suggestedMapping[h] && (
                        <Badge tone="gold" icon={<Sparkles className="size-3" aria-hidden />} title="Sugestão automática pelo nome da coluna">
                          Sugerido
                        </Badge>
                      )}
                    </div>
                    {duplicate && (
                      <p role="alert" className="mt-1 text-[11.5px] font-medium text-danger">
                        Este campo está em mais de uma coluna.
                      </p>
                    )}
                    {hint && !duplicate && <p className="mt-1 text-[11.5px] text-muted">{hint}</p>}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Panel>

      {hasProcess && !Object.values(mapping).includes("client.document") && (
        <Callout tone="warning" title="Sem a coluna de CPF/CNPJ">
          Cada processo será ligado ao cliente <strong>já cadastrado</strong> no DG Brasil com o mesmo nome (sem diferença de acento ou maiúsculas). Linha cujo cliente não for
          encontrado, ou tiver mais de um cadastro com o mesmo nome, fica de fora com o motivo. Nenhum cliente novo é criado. Dica: importe antes a planilha de clientes, com CPF/CNPJ.
        </Callout>
      )}

      {hasProcess && (
        <Panel>
          <PanelHeader
            title="Casos e processos novos"
            description="Todo processo no DG Brasil pertence a um caso. Para cada processo novo, a importação cria um caso já em andamento, com a área e o advogado abaixo (o “Responsável” da linha, quando é advogado da equipe, tem prioridade)."
          />
          <PanelBody className="grid grid-cols-2 gap-4">
            <Field label="Área jurídica dos casos" requirement="required">
              {(p) => <Select {...p} value={areaId} onChange={(e) => setAreaId(e.target.value)} options={reference.areas.map((a) => ({ value: a.id, label: a.name }))} placeholder="Escolha" disabled={busy} />}
            </Field>
            <Field label="Advogado responsável padrão" requirement="required" hint="Usado quando a linha não tem responsável da equipe.">
              {(p) => <Select {...p} value={lawyerId} onChange={(e) => setLawyerId(e.target.value)} options={lawyers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Escolha" disabled={busy} />}
            </Field>
          </PanelBody>
        </Panel>
      )}

      <Panel>
        <PanelFooter className="justify-between">
          <div className="text-[12.5px]">
            {problems.length ? (
              <ul className="space-y-0.5 text-danger">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">A simulação lê o arquivo inteiro e confere cada linha. Nada é gravado em clientes ou processos.</span>
            )}
          </div>
          <Button
            icon={<ArrowRight className="size-4" aria-hidden />}
            loading={busy}
            disabled={problems.length > 0}
            onClick={() =>
              onSubmit({
                mapping: Object.entries(mapping)
                  .filter(([, f]) => f)
                  .map(([sourceColumn, targetField]) => ({ sourceColumn, targetField: targetField as ImportFieldKey })),
                options,
              })
            }
          >
            Validar e simular
          </Button>
        </PanelFooter>
      </Panel>
    </div>
  );
}
