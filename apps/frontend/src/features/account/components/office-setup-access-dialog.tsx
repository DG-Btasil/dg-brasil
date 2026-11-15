"use client";

import { useEffect, useState } from "react";
import { callAction, type ActionResult } from "@/lib/actions/result";
import { useActionFeedback } from "@/lib/actions/use-action-feedback";
import { ActionErrorState } from "@/components/feedback/action-error";
import { SkeletonRows } from "@/components/feedback/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { listOfficeSetupAccessAction, setOfficeSetupAccessAction } from "@/server/domain/account/actions";
import type { OfficeSetupAdminDTO } from "@/server/domain/account/setup";

/**
 * "Adicionar visibilidade" (076): os ADMINs ativos do escritório e quem vê o
 * botão Setup. Quem já vê pode dar o acesso a outro ADMIN (reserva, se a conta
 * principal se perder) ou tirar. A conta principal sempre vê.
 */
export function OfficeSetupAccessDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<ActionResult<OfficeSetupAdminDTO[]> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const failed = useActionFeedback();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    callAction(() => listOfficeSetupAccessAction()).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [open, version]);

  // Ao fechar, a lista some: na próxima abertura ela vem do banco de novo.
  function close() {
    setResult(null);
    onClose();
  }

  function retry() {
    setResult(null);
    setVersion((v) => v + 1);
  }

  async function toggle(admin: OfficeSetupAdminDTO) {
    setBusy(admin.userId);
    const r = await callAction(() => setOfficeSetupAccessAction({ userId: admin.userId, access: !admin.access }));
    setBusy(null);
    if (!r.ok) return failed(r, "Não foi possível mudar o acesso.");
    setResult(r);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && close()}
      size="sm"
      title="Visibilidade do setup"
      description="Administradores do DG Brasil. Quem tem acesso vê o botão Setup e pode dar acesso a outro administrador."
      footer={<Button onClick={close} disabled={!!busy}>Fechar</Button>}
    >
      {!result ? (
        <SkeletonRows rows={3} />
      ) : !result.ok ? (
        <ActionErrorState error={result} onRetry={retry} title="Não foi possível carregar os administradores." />
      ) : (
        <ul className="divide-y divide-line">
          {result.data.map((a) => (
            <li key={a.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-foreground">
                  {a.name}
                  {a.me && <span className="font-normal text-muted"> (você)</span>}
                </p>
                {a.email && <p className="truncate text-[12px] text-muted">{a.email}</p>}
              </div>
              {a.main ? (
                <Badge tone="neutral">Conta principal</Badge>
              ) : (
                <Button
                  size="sm"
                  variant={a.access ? "secondary" : "primary"}
                  loading={busy === a.userId}
                  disabled={!!busy && busy !== a.userId}
                  onClick={() => toggle(a)}
                >
                  {a.access ? "Tirar acesso" : "Dar acesso"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
