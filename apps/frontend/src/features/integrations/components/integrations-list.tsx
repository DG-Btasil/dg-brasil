"use client";

import { useState, type ReactNode } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { NotAvailable } from "@/components/ui/tooltip";
import { Callout } from "@/components/feedback/states";
import { usePermission } from "@/features/auth/hooks";
import type { Integration } from "@/types";
import { useIntegrationActions, useIntegrations } from "../hooks";
import { IntegrationCard } from "./integration-card";

/** Cartões de todas as integrações do escritório. */
export function IntegrationsList() {
  const integrations = useIntegrations();
  const canManage = usePermission("settings.integrations.manage");
  const canSeeAi = usePermission("settings.ai.view");

  return (
    <div className="space-y-4">
      {!canManage && (
        <Callout tone="neutral" title="Somente leitura">
          Apenas administradores conectam, reconectam ou sincronizam integrações.
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-4">
        {/* A integração processual tem área própria (Integração Judicial), com uma fonte por provedor. */}
        {integrations.filter((i) => i.kind !== "JUDICIAL").map((i) => (
          <IntegrationItem key={i.id} integration={i} canManage={canManage} canSeeAi={canSeeAi} />
        ))}
      </div>
      <p className="text-[12px] text-subtle">
        Credenciais de integrações nunca são solicitadas nem armazenadas no navegador. No produto final, ficam criptografadas no backend seguro do DG Brasil.
      </p>
    </div>
  );
}

function IntegrationItem({ integration, canManage, canSeeAi }: { integration: Integration; canManage: boolean; canSeeAi: boolean }) {
  const { setStatus } = useIntegrationActions();
  const [busy, setBusy] = useState<"status" | null>(null);

  async function run(kind: "status", fn: () => Promise<void>) {
    setBusy(kind);
    await fn();
    setBusy(null);
  }

  const i = integration;
  let actions: ReactNode = null;

  if (i.kind === "AI_PROVIDER") {
    actions = canSeeAi ? (
      <ButtonLink href="/configuracoes?secao=ia" variant="secondary" size="sm">
        Ver conexão e consumo
      </ButtonLink>
    ) : null;
  } else if (!canManage) {
    actions = null;
  } else if (i.status === "ERROR") {
    actions = (
      <Button size="sm" icon={<RefreshCw className="size-3.5" aria-hidden />} loading={busy === "status"} onClick={() => run("status", () => setStatus(i, "CONNECTED"))}>
        Reconectar (simulado)
      </Button>
    );
  } else if (i.status === "DISCONNECTED" || i.status === "PENDING") {
    actions = (
      <>
        <NotAvailable message="Conexão real disponível em uma próxima etapa (backend)">
          <Button size="sm" variant="secondary" icon={<Link2 className="size-3.5" aria-hidden />}>
            Conectar conta real
          </Button>
        </NotAvailable>
        <Button size="sm" variant="ghost" loading={busy === "status"} onClick={() => run("status", () => setStatus(i, "CONNECTED"))}>
          Conectar (simulado)
        </Button>
      </>
    );
  } else {
    actions = (
      <NotAvailable>
        <Button size="sm" variant="secondary">
          Gerenciar
        </Button>
      </NotAvailable>
    );
  }

  return <IntegrationCard integration={i} actions={actions} />;
}
