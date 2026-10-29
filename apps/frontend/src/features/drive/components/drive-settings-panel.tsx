"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PlugZap, Sparkles } from "lucide-react";
import { ActionErrorState } from "@/components/feedback/action-error";
import { Callout, EmptyState, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/table";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatEventTime, formatNumber } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import { getDriveStatusAction, getDriveSuggestionsAction, linkDriveFolderAction, testDriveAction } from "@/server/domain/drive/actions";
import type { DriveStatusDTO, DriveSuggestionDTO } from "@/server/domain/drive/dto";
import { useToast } from "@/store/ui-store";

/**
 * Google Drive em Configurações → Integrações (041): situação, testar a
 * conexão (ADMIN) e ligar as pastas que já existem, com sugestão por nome e
 * confirmação humana de cada uma.
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

  if (!status) return <SkeletonRows rows={3} />;
  if (!status.ok) return <ActionErrorState error={status} title="Não foi possível ler a situação do Google Drive." />;
  const s = status.data;

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
              A conexão é feita no servidor (variáveis <code className="font-mono">GOOGLE_DRIVE_*</code>), nunca pelo navegador nem pelo computador do escritório. Veja o guia em docs/mcp/google-drive.md.
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
            <Callout tone="warning">Falta indicar a pasta que contém as pastas dos clientes (GOOGLE_DRIVE_ROOT_FOLDER_ID). Sem ela, a busca procura no Drive inteiro e não há sugestões.</Callout>
          )}
          {s.syncErrors > 0 && <Callout tone="warning">{s.syncErrors} pasta(s) com aviso na última sincronização. Abra o cliente para ver o detalhe.</Callout>}
          <div className="flex flex-wrap gap-2">
            {isAdmin && s.configured && (
              <Button size="sm" variant="secondary" icon={<PlugZap className="size-4" aria-hidden />} loading={testing} onClick={test}>
                Testar conexão
              </Button>
            )}
            {canLink && s.configured && s.rootFolderConfigured && (
              <Button size="sm" icon={<Sparkles className="size-4" aria-hidden />} loading={loadingSuggestions} onClick={loadSuggestions}>
                Sugerir ligações
              </Button>
            )}
          </div>
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
                      {x.folders.map((f) => f.name).join(" · ")}
                      {!x.exact && <span className="ml-1.5 text-subtle">(nome parecido: confira)</span>}
                    </Td>
                    <Td className="text-right">
                      {x.folders.length === 1 ? (
                        <Button size="sm" variant="secondary" loading={linking === x.clientId} onClick={() => link(x, x.folders[0]!.id)}>
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
