"use client";

import { RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/layout/guards";
import { ErrorState } from "@/components/feedback/states";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * Falha inesperada numa tela da área autenticada (rede caiu, servidor fora).
 * O menu continua de pé e dá para tentar de novo. Nunca mostra a mensagem
 * técnica nem stack: só o código (digest), que liga ao log do servidor.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <PageContainer>
      <Panel>
        <ErrorState
          title="Não foi possível carregar esta página."
          description={
            <>
              Verifique a conexão e tente novamente.
              {error.digest && <span className="mt-1 block text-[12px] text-subtle">Código de referência: {error.digest.slice(0, 10).toUpperCase()}</span>}
            </>
          }
          action={
            <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => retry()}>
              Tentar novamente
            </Button>
          }
        />
      </Panel>
    </PageContainer>
  );
}
