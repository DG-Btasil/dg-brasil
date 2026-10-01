import { FolderX } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export function CaseNotFound() {
  return (
    <Panel className="mt-4">
      <EmptyState
        icon={FolderX}
        title="Caso não encontrado."
        description="O caso pode ter sido removido, não estar disponível para você ou o endereço está incorreto."
        action={
          <ButtonLink href="/casos" variant="secondary">
            Voltar para Casos
          </ButtonLink>
        }
      />
    </Panel>
  );
}
