"use client";

import { useEffect, useState } from "react";
import { Copy, Download } from "lucide-react";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { canUseOfficeSetupAction, issueOfficeSetupAction } from "@/server/domain/account/actions";
import { useToast } from "@/store/ui-store";

/**
 * Setup do DG Brasil (072). Só aparece para a dona do escritório (o banco
 * decide); para os outros, nada é desenhado. "Autorizar" copia um comando para
 * colar no PowerShell (não baixa arquivo: o Windows 11 bloqueia .cmd vindo da
 * internet). O comando leva só um código de uso único, que vence em 15 minutos.
 */
export function OfficeSetupRow() {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const failed = useActionFeedback();
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    callAction(() => canUseOfficeSetupAction()).then((r) => alive && setAllowed(r.ok && r.data === true));
    return () => {
      alive = false;
    };
  }, []);

  if (!allowed) return null;

  function close() {
    setOpen(false);
    setCommand(null);
    setCopied(false);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      return true;
    } catch {
      setCopied(false);
      return false;
    }
  }

  async function authorize() {
    setBusy(true);
    const r = await callAction(() => issueOfficeSetupAction());
    setBusy(false);
    if (!r.ok) return failed(r, "Não foi possível preparar o setup.");
    setCommand(r.data.command);
    if (!(await copy(r.data.command))) toast({ tone: "warning", title: "Não foi possível copiar", description: "Selecione o comando e copie à mão." });
  }

  return (
    <li className="flex items-center gap-4 py-3 last:pb-0">
      <Download className="size-4 shrink-0 text-navy-700" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-foreground">Setup</p>
        <p className="text-[12px] text-muted">DG Brasil</p>
      </div>
      <Button size="sm" onClick={() => setOpen(true)}>
        Setup
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && !busy && close()}
        size="sm"
        title={command ? (copied ? "Comando copiado" : "Copie o comando") : "Você deseja instalar o setup?"}
        description={
          command
            ? "Abra o PowerShell neste computador, cole (Ctrl+V) e aperte Enter. Vale por 15 minutos."
            : "Se o setup já estiver instalado, ele será removido e atualizaremos para a versão mais recente."
        }
        footer={
          command ? (
            <>
              <Button variant="secondary" icon={<Copy className="size-4" aria-hidden />} onClick={() => copy(command)}>
                Copiar de novo
              </Button>
              <Button onClick={close}>Fechar</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={close}>
                Negar
              </Button>
              <Button loading={busy} onClick={authorize}>
                Autorizar
              </Button>
            </>
          )
        }
      >
        {command && !copied && (
          <pre className="overflow-x-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-[11.5px] text-foreground">{command}</pre>
        )}
      </Dialog>
    </li>
  );
}
