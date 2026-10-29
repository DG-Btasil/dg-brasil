"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FolderSync, Link2, Unlink } from "lucide-react";
import { Callout, SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { DefinitionGrid, Panel, PanelBody, PanelHeader } from "@/components/ui/panel";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { formatEventTime, formatNumber } from "@/lib/formatting";
import { usePermission } from "@/features/auth/hooks";
import { getClientDriveAction, syncClientDriveAction, unlinkDriveFolderAction } from "@/server/domain/drive/actions";
import type { ClientDriveDTO } from "@/server/domain/drive/dto";
import { useToast } from "@/store/ui-store";
import { LinkFolderDialog } from "./link-folder-dialog";

/**
 * Pasta do cliente no Google Drive (041). A ligação é pelo ID da pasta (o
 * nome é só exibição). Arquivos novos da pasta entram como documentos
 * internos; versões aprovadas em Revisões vão para a pasta como arquivo novo.
 */
export function ClientDrivePanel({ clientId }: { clientId: string }) {
  const canManage = usePermission("analyses.start");
  const toast = useToast();
  const failed = useActionFeedback();
  const [data, setData] = useState<ActionResult<ClientDriveDTO> | null>(null);
  const [version, setVersion] = useState(0);
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    callAction(() => getClientDriveAction({ clientId })).then((r) => alive && setData(r));
    return () => {
      alive = false;
    };
  }, [clientId, version]);

  if (!data) return <SkeletonRows rows={2} />;
  if (!data.ok) return null;
  const d = data.data;
  if (!d.configured && !d.link) return null;

  async function sync() {
    setBusy(true);
    const r = await callAction(() => syncClientDriveAction({ clientId }));
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível sincronizar com o Drive.");
      return;
    }
    toast({ tone: "success", title: "Drive sincronizado", description: `${r.data.imported} arquivo(s) novo(s) importado(s); ${r.data.exported} enviado(s) ao Drive.` });
    reload();
  }

  async function unlink() {
    setBusy(true);
    const r = await callAction(() => unlinkDriveFolderAction({ clientId }));
    setBusy(false);
    if (!r.ok) {
      failed(r, "Não foi possível desligar a pasta.");
      return;
    }
    setUnlinking(false);
    toast({ tone: "success", title: "Pasta desligada", description: "Os documentos já importados continuam no DG Brasil." });
    reload();
  }

  return (
    <Panel className="mb-5">
      <PanelHeader
        title="Pasta no Google Drive"
        description="Arquivos novos da pasta entram aqui como documentos internos. Versões aprovadas em Revisões vão para a pasta."
        actions={d.link ? <Badge tone={d.link.lastSyncError ? "gold" : "success"}>{d.link.lastSyncError ? "Com aviso" : "Ligada"}</Badge> : <Badge tone="neutral">Sem pasta</Badge>}
      />
      <PanelBody className="space-y-3">
        {d.link ? (
          <>
            <DefinitionGrid
              columns={4}
              items={[
                {
                  label: "Pasta",
                  value: (
                    <a href={d.link.folderUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-navy hover:underline underline-offset-2">
                      {d.link.folderName ?? "Abrir no Drive"} <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  ),
                },
                { label: "Última sincronização", value: d.link.lastSyncedAt ? formatEventTime(d.link.lastSyncedAt) : "Ainda não" },
                { label: "Importados", value: formatNumber(d.imports) },
                { label: "Enviados ao Drive", value: `${formatNumber(d.exports.exported)}${d.exports.pending ? ` · ${d.exports.pending} na fila` : ""}${d.exports.failed ? ` · ${d.exports.failed} com falha` : ""}` },
              ]}
            />
            {d.link.lastSyncError && <Callout tone="warning">{d.link.lastSyncError}</Callout>}
            {!d.configured && <Callout tone="warning">O Google Drive não está configurado no servidor: a pasta está ligada, mas nada sincroniza até configurar.</Callout>}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={<FolderSync className="size-4" aria-hidden />} loading={busy} disabled={!d.configured} onClick={sync}>
                  Sincronizar agora
                </Button>
                <Button size="sm" variant="secondary" icon={<Link2 className="size-4" aria-hidden />} disabled={!d.configured} onClick={() => setLinking(true)}>
                  Trocar pasta
                </Button>
                <Button size="sm" variant="ghost" icon={<Unlink className="size-4" aria-hidden />} onClick={() => setUnlinking(true)}>
                  Desligar
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted">Ligue a pasta do cliente no Drive para trazer os documentos de lá e mandar para lá o que for aprovado.</p>
            {canManage && (
              <Button size="sm" icon={<Link2 className="size-4" aria-hidden />} onClick={() => setLinking(true)}>
                Ligar pasta
              </Button>
            )}
          </div>
        )}
      </PanelBody>
      {linking && <LinkFolderDialog clientId={clientId} onClose={() => setLinking(false)} onLinked={reload} />}
      <Dialog
        open={unlinking}
        onOpenChange={setUnlinking}
        size="sm"
        title="Desligar a pasta do Drive?"
        description="Nada é apagado: os documentos importados continuam no DG Brasil e os arquivos continuam no Drive. O que estava na fila para enviar não vai mais."
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnlinking(false)}>
              Voltar
            </Button>
            <Button variant="danger" loading={busy} onClick={unlink}>
              Desligar
            </Button>
          </>
        }
      />
    </Panel>
  );
}
