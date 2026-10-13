import { Clock3 } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "./states";

/**
 * Seção de uma tela já ligada ao backend cujo domínio ainda não foi conectado
 * (Etapa 4.3, migração domínio a domínio). Honesta: não mostra dado de
 * demonstração nem "nenhum registro" que pode não ser verdade.
 */
export function PendingIntegration({ title = "Seção em integração", description }: { title?: string; description?: string }) {
  return (
    <Panel>
      <EmptyState
        compact
        icon={Clock3}
        title={title}
        description={description ?? "Os dados desta seção serão conectados ao sistema em uma próxima etapa. Nada foi perdido."}
      />
    </Panel>
  );
}
