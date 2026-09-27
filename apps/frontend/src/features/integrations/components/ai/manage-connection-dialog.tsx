"use client";

import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NotAvailable } from "@/components/ui/tooltip";
import { Callout } from "@/components/feedback/states";

/** Explica o fluxo seguro de conexão. A API key nunca passa pelo navegador. */
export function ManageConnectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gerenciar conexão com a Claude Platform"
      description="Como a credencial do escritório é tratada."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <NotAvailable message="Fluxo seguro de conexão disponível com o backend">
            <Button icon={<KeyRound className="size-4" aria-hidden />}>Iniciar conexão segura</Button>
          </NotAvailable>
        </>
      }
    >
      <div className="space-y-4 text-[13px] leading-relaxed text-foreground">
        <Callout tone="success" title="A API key nunca é solicitada nem armazenada no navegador">
          Nenhum campo desta tela pede a chave. Todas as chamadas aos modelos saem do backend do DG Brasil, nunca do seu computador.
        </Callout>
        <ul className="space-y-2.5">
          {[
            "A conexão será iniciada por um fluxo servidor-a-servidor, fora desta interface.",
            "A credencial fica criptografada no backend seguro, segregada por escritório.",
            "A interface recebe apenas metadados: status, organização, modelos e consumo.",
            "Rotação e revogação da chave serão feitas pelo backend, com registro na auditoria.",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-navy-700" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-muted">Nesta demonstração a conexão exibida é simulada.</p>
      </div>
    </Dialog>
  );
}
