"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, PlugZap, RefreshCw, Sparkles, Square } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatEventTime, formatNumber, pluralize } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import {
  getDriveStatusAction,
  getDriveSuggestionsAction,
  linkDriveFolderAction,
  linkDriveFoldersAction,
  syncAllDriveAction,
  testDriveAction,
} from "@/server/domain/drive/actions";
import type { DriveStatusDTO, DriveSuggestionDTO } from "@/server/domain/drive/dto";
import { useToast } from "@/store/ui-store";

/** Uma pasta de nome igual, e só uma: dá para ligar em lote. */
const isExact = (s: DriveSuggestionDTO) => s.exact && s.folders.length === 1;

interface SyncAllProgress {
  visited: number;
  total: number;
  imported: number;
  failed: number;
  pending: number;
}

/**
 * Google Drive em Configurações → Integrações (041): situação, testar a
 * conexão (ADMIN) e ligar as pastas que já existem, com sugestão por nome e
 * confirmação humana de cada uma. O ADMIN também liga de uma vez as sugestões
 * exatas e roda "Sincronizar tudo agora" (lotes repetidos até acabar).
 */
export function DriveSettingsPanel() {
  const isAdmin = usePermission("dgbrasil.manage");
  const canLink = usePermission("analyses.start");
  const toast = useToast();
  const failed = useActionFeedback();
  const [status, setStatus] = useState<ActionResult<DriveStatusDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [testing, setTesting] = useState(false);
  const [suggestions, setSuggestions] = useState<DriveSuggestionDTO[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkFailures, setBulkFailures] = useState<{ clientName: string; reason: string }[]>([]);
  const [syncing, setSyncing] = useState<SyncAllProgress | null>(null);
  const stopRef = useRef(false);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => getDriveStatusAction()).then((r) => alive && setStatus(r));
    return () => {
      alive = false;
    };
  }, [version]);

  async function test() {
    setTesting(true);
    const r = await callAction(() => testDriveAction());
    setTesting(false);
    if (!r.ok) {
      failed(r, "A conexão com o Drive falhou.");
      return;
    }
    toast({ tone: "success", title: "Drive conectado", description: `${r.data.email ?? "Conta conectada"}${r.data.rootFolderName ? ` · pasta dos clientes: ${r.data.rootFolderName}` : ""}` });
  }

  async function loadSuggestions() {
    setLoadingSuggestions(true);
    setBulkFailures([]);
    const r = await callAction(() => getDriveSuggestionsAction());
    setLoadingSuggestions(false);
    if (!r.ok) {
      failed(r, "Não foi possível montar as sugestões.");
      return;
    }
    setSuggestions(r.data);
  }

  async function link(s: DriveSuggestionDTO, folderId: string) {
    setLinking(s.clientId);
    const r = await callAction(() => linkDriveFolderAction({ clientId: s.clientId, folderId }));
    setLinking(null);
    if (!r.ok) {
      failed(r, "Não foi possível ligar a pasta.");
      return;
    }
    setSuggestions((list) => list?.filter((x) => x.clientId !== s.clientId) ?? null);
    reload();
  }

  /** Liga as sugestões exatas em lotes de 10; cada pasta passa pelas mesmas conferências do "Ligar". */
  async function linkAllExact() {
    const list = (suggestions ?? []).filter(isExact);
    if (!list.length) return;
    const names = new Map(list.map((x) => [x.clientId, x.clientName]));
    let queue = list.map((x) => ({ clientId: x.clientId, folderId: x.folders[0]!.id }));
    const linked = new Set<string>();
    const failures: { clientName: string; reason: string }[] = [];
    setBulkFailures([]);
    setBulk({ done: 0, total: list.length });
    while (queue.length) {
      const chunk = queue.slice(0, 10);
      const r = await callAction(() => linkDriveFoldersAction({ items: chunk }));
      if (!r.ok) {
        failed(r, "A ligação em lote parou. O que já foi ligado continua ligado.");
        break;
      }
      r.data.linked.forEach((id) => linked.add(id));
      failures.push(...r.data.failed.map((f) => ({ clientName: names.get(f.clientId) ?? "Cliente", reason: f.reason })));
      const again = new Set(r.data.notProcessed);
      if (again.size === chunk.length) break; // nada andou neste lote: não repete para sempre
      queue = [...chunk.filter((i) => again.has(i.clientId)), ...queue.slice(chunk.length)];
      setBulk({ done: linked.size + failures.length, total: list.length });
    }
    setBulk(null);
    setBulkFailures(failures);
    setSuggestions((cur) => cur?.filter((x) => !linked.has(x.clientId)) ?? null);
    toast({
      tone: failures.length ? "warning" : "success",
      title: pluralize(linked.size, "pasta ligada", "pastas ligadas"),
      description: failures.length
        ? `${pluralize(failures.length, "pasta não foi ligada", "pastas não foram ligadas")}. O motivo está na lista.`
        : "Os arquivos entram na próxima sincronização.",
    });
    reload();
  }

  /** Repete o lote no servidor até não sobrar pasta para conferir. */
  async function syncAll() {
    stopRef.current = false;
    let state = { visited: [] as string[], pending: [] as string[] };
    let imported = 0;
    let failedFiles = 0;
    setSyncing({ visited: 0, total: status?.ok ? status.data.linkedClients : 0, imported: 0, failed: 0, pending: 0 });
    for (;;) {
      const r = await callAction(() => syncAllDriveAction(state));
      if (!r.ok) {
        failed(r, "A sincronização parou. O que já entrou continua no DG Brasil; é só mandar de novo.");
        break;
      }
      imported += r.data.imported;
      failedFiles += r.data.failed;
      state = { visited: r.data.visited, pending: r.data.pending };
      setSyncing({ visited: r.data.visited.length, total: r.data.total, imported, failed: failedFiles, pending: r.data.pending.length });
      if (r.data.done) {
        toast({
          tone: failedFiles ? "warning" : "success",
          title: "Sincronização concluída",
          description: `${pluralize(r.data.visited.length, "pasta conferida", "pastas conferidas")} · ${pluralize(imported, "arquivo trazido", "arquivos trazidos")}${
            failedFiles ? ` · ${pluralize(failedFiles, "arquivo com falha", "arquivos com falha")}, com nova tentativa na próxima rodada` : ""
          }`,
        });
        break;
      }
      if (stopRef.current) {
        toast({ tone: "info", title: "Sincronização interrompida", description: `${pluralize(imported, "arquivo trazido", "arquivos trazidos")} até aqui. A rodada automática continua a cada 15 minutos.` });
        break;
      }
    }
    setSyncing(null);
    reload();
  }

  if (!status) return <SkeletonRows rows={3} />;
  if (!status.ok) return <ActionErrorState error={status} title="Não foi possível ler a situação do Google Drive." />;
  const s = status.data;
  const exactCount = (suggestions ?? []).filter(isExact).length;
  const syncPct = syncing && syncing.total ? Math.min(100, Math.round((Math.min(syncing.visited, syncing.total) / syncing.total) * 100)) : 0;

  return (
    <section aria-labelledby="drive-title" className="space-y-3">
      <h3 id="drive-title" className="text-[15px] font-semibold text-foreground">
        Google Drive
      </h3>
      <Panel>
        <PanelHeader
          title="Pastas dos clientes"
          description="O DG Brasil continua o arquivo oficial. O Drive é a pasta de trabalho da equipe: arquivos novos entram como documentos internos; o que for aprovado em Revisões vai para a pasta."
          actions={<Badge tone={s.configured ? "success" : "neutral"}>{s.configured ? (s.mode === "service_account" ? "Conectado (conta de serviço)" : "Conectado (conta do escritório)") : "Não configurado"}</Badge>}
        />
        <PanelBody className="space-y-3">
          {!s.configured ? (
            <Callout tone="info">
              O Google Drive ainda não foi conectado. A conexão é feita uma única vez por quem cuida da instalação do sistema, nunca pelo navegador nem pelo computador do escritório.
            </Callout>
          ) : (
            <DefinitionGrid
              columns={4}
              items={[
                { label: "Clientes com pasta", value: formatNumber(s.linkedClients) },
                { label: "Arquivos importados", value: formatNumber(s.imports) },
                { label: "Na fila para o Drive", value: `${formatNumber(s.exportsPending)}${s.exportsFailed ? ` · ${s.exportsFailed} com falha` : ""}` },
                { label: "Última sincronização", value: s.lastSyncAt ? formatEventTime(s.lastSyncAt) : "Ainda não" },
              ]}
            />
          )}
          {s.configured && !s.rootFolderConfigured && (
            <Callout tone="warning">Falta indicar a pasta que contém as pastas dos clientes. Sem ela, a busca procura no Drive inteiro e não há sugestões. Peça o ajuste a quem cuida da instalação do sistema.</Callout>
          )}
          {s.syncErrors > 0 && <Callout tone="warning">{s.syncErrors} pasta(s) com aviso na última sincronização. Abra o cliente para ver o detalhe.</Callout>}
          <div className="flex flex-wrap gap-2">
            {isAdmin && s.configured && (
              <Button size="sm" variant="secondary" icon={<PlugZap className="size-4" aria-hidden />} loading={testing} onClick={test}>
                Testar conexão
              </Button>
            )}
            {canLink && s.configured && s.rootFolderConfigured && (
              <Button size="sm" icon={<Sparkles className="size-4" aria-hidden />} loading={loadingSuggestions} disabled={!!bulk} onClick={loadSuggestions}>
                Sugerir ligações
              </Button>
            )}
            {isAdmin && exactCount > 0 && (
              <Button size="sm" variant="secondary" icon={<Link2 className="size-4" aria-hidden />} loading={!!bulk} onClick={linkAllExact}>
                Ligar todas as sugestões exatas ({formatNumber(exactCount)})
              </Button>
            )}
            {isAdmin && s.configured && s.linkedClients > 0 && !syncing && (
              <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} disabled={!!bulk} onClick={syncAll}>
                Sincronizar tudo agora
              </Button>
            )}
          </div>
          {bulk && (
            <p className="text-[12.5px] text-muted" aria-live="polite">
              Ligando as pastas: {formatNumber(bulk.done)} de {formatNumber(bulk.total)}. Cada pasta é conferida no Drive antes de ligar.
            </p>
          )}
          {bulkFailures.length > 0 && (
            <Callout tone="warning" title={pluralize(bulkFailures.length, "pasta não foi ligada", "pastas não foram ligadas")}>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {bulkFailures.map((f, i) => (
                  <li key={i}>
                    <span className="font-medium">{f.clientName}</span>: {f.reason}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          {syncing && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={syncPct} aria-label="Progresso da sincronização">
                <div className="h-full bg-navy transition-[width]" style={{ width: `${syncPct}%` }} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-muted" aria-live="polite">
                  {formatNumber(Math.min(syncing.visited, syncing.total))} de {formatNumber(syncing.total)} pastas conferidas · {pluralize(syncing.imported, "arquivo trazido", "arquivos trazidos")}
                  {syncing.pending > 0 && ` · ${pluralize(syncing.pending, "pasta ainda com arquivos", "pastas ainda com arquivos")}`}
                  {syncing.failed > 0 && ` · ${pluralize(syncing.failed, "arquivo com falha", "arquivos com falha")}`}
                </p>
                <Button size="sm" variant="ghost" icon={<Square className="size-3.5" aria-hidden />} onClick={() => (stopRef.current = true)}>
                  Parar
                </Button>
              </div>
              <p className="text-[12px] text-subtle">Pode sair desta tela: o que já entrou fica, e a rodada automática continua a cada 15 minutos.</p>
            </div>
          )}
        </PanelBody>
        {suggestions && (
          suggestions.length === 0 ? (
            <EmptyState compact title="Nenhuma sugestão." description="Os clientes sem pasta não têm pasta com o mesmo nome no Drive. Ligue pela ficha do cliente." />
          ) : (
            <Table caption="Sugestões de ligação cliente → pasta">
              <THead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Pasta no Drive</Th>
                  <Th className="text-right">Ação</Th>
                </tr>
              </THead>
              <TBody>
                {suggestions.map((x) => (
                  <Tr key={x.clientId}>
                    <Td>
                      <Link href={`/clientes/${x.clientId}?aba=documentos`} className="font-medium text-navy hover:underline underline-offset-2">
                        {x.clientName}
                      </Link>
                    </Td>
                    <Td className="text-[12.5px]">
                      {x.folders.map((f) => (f.path ? `${f.name} (${f.path})` : f.name)).join(" · ")}
                      {!x.exact && <span className="ml-1.5 text-subtle">(nome parecido: confira)</span>}
                    </Td>
                    <Td className="text-right">
                      {x.folders.length === 1 ? (
                        <Button size="sm" variant="secondary" loading={linking === x.clientId} disabled={!!bulk} onClick={() => link(x, x.folders[0]!.id)}>
                          Ligar
                        </Button>
                      ) : (
                        <span className="text-[12px] text-muted">Várias pastas: ligue pela ficha</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )
        )}
      </Panel>
    </section>
  );
}
