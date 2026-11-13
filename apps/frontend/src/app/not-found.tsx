import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/feedback/states";
import { StandalonePage } from "@/components/layout/standalone-page";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Página não encontrada" };

/**
 * Endereço que não existe, fora da área autenticada (dentro dela vale
 * `(app)/not-found.tsx`, que mantém o menu). "/" decide no servidor para onde a
 * pessoa vai: o Início, o login ou o passo de segurança que falta.
 */
export default function NotFound() {
  return (
    <StandalonePage>
      <EmptyState
        icon={Compass}
        title="Página não encontrada."
        description="O endereço pode estar incorreto ou a página foi removida."
        action={<ButtonLink href="/">Voltar para o Início</ButtonLink>}
      />
    </StandalonePage>
  );
}
