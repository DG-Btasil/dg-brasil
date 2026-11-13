"use client";

import { RotateCcw } from "lucide-react";
import { ErrorState } from "@/components/feedback/states";
import { StandalonePage } from "@/components/layout/standalone-page";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * Falha inesperada FORA da área autenticada (login, MFA, termos, primeiro
 * acesso, recuperação de senha). Dentro dela vale `(app)/error.tsx`, que mantém
 * o menu. Nunca mostra a mensagem técnica: só o código (digest), que liga ao
 * log do servidor.
 */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <StandalonePage>
      <ErrorState
        title="Não foi possível carregar esta página."
        description={
          <>
            Verifique a conexão e tente novamente.
            {digest && <span className="mt-1 block text-[12px] text-subtle">Código de referência: {digest.slice(0, 10).toUpperCase()}</span>}
          </>
        }
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => retry()}>
              Tentar novamente
            </Button>
            <ButtonLink href="/" variant="ghost">
              Voltar para o Início
            </ButtonLink>
          </div>
        }
      />
    </StandalonePage>
  );
}
