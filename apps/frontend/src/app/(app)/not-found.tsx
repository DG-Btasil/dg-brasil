import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { PageContainer } from "@/components/layout/guards";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Página não encontrada" };

/** Endereço que não existe dentro da área autenticada: o menu continua de pé. */
export default function AppNotFound() {
  return (
    <PageContainer>
      <Panel>
        <EmptyState
          icon={Compass}
          title="Página não encontrada."
          description="O endereço pode estar incorreto ou a página foi removida. Use o menu ou volte para o Início."
          action={<ButtonLink href="/home">Voltar para o Início</ButtonLink>}
        />
      </Panel>
    </PageContainer>
  );
}
