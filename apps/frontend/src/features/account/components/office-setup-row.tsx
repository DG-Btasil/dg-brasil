"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { callAction } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { canUseOfficeSetupAction, issueOfficeSetupAction } from "@/server/domain/account/actions";
import { useToast } from "@/store/ui-store";

/**
 * Setup do DG Brasil (072). Só aparece para a dona do escritório (o banco
 * decide); para os outros, nada é desenhado. Sem explicação de propósito: o
 * arquivo baixado leva só um código de uso único, que vence em 15 minutos.
 */
export function OfficeSetupRow() {
  const [allowed, setAllowed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function authorize() {
    setBusy(true);
    const r = await callAction(() => issueOfficeSetupAction());
    setBusy(false);
    if (!r.ok) return failed(r, "Não foi possível preparar o setup.");
    const url = URL.createObjectURL(new Blob([r.data.content], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = r.data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
    toast({ tone: "success", title: "Setup baixado", description: "Abra o arquivo no computador em até 15 minutos." });
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
        onOpenChange={(o) => !o && !busy && setOpen(false)}
        size="sm"
        title="Você deseja instalar o setup?"
        description="Se o setup já estiver instalado, ele será removido e atualizaremos para a versão mais recente."
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Negar
            </Button>
            <Button loading={busy} onClick={authorize}>
              Autorizar
            </Button>
          </>
        }
      />
    </li>
  );
}
