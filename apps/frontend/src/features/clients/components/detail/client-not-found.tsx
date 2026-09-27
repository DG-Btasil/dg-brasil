import { UserX } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export function ClientNotFound() {
  return (
    <Panel className="mt-4">
      <EmptyState
        icon={UserX}
        title="Cliente não encontrado."
        description="O cadastro pode ter sido removido ou o endereço está incorreto."
        action={
          <ButtonLink href="/clientes" variant="secondary">
            Voltar para Clientes
          </ButtonLink>
        }
      />
    </Panel>
  );
}
