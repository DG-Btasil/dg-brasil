import { SearchX } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { Panel } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/states";

export function DgNotFound({ title, backHref, backLabel }: { title: string; backHref: string; backLabel: string }) {
  return (
    <PageContainer>
      <Panel>
        <EmptyState
          icon={SearchX}
          title={title}
          description="O item pode ter sido removido ou o endereço está incorreto."
          action={
            <ButtonLink href={backHref} variant="secondary">
              {backLabel}
            </ButtonLink>
          }
        />
      </Panel>
    </PageContainer>
  );
}
