"use client";

import "./globals.css";
import { RotateCcw } from "lucide-react";
import { ErrorState } from "@/components/feedback/states";
import { StandalonePage } from "@/components/layout/standalone-page";
import { Button, buttonClasses } from "@/components/ui/button";

/**
 * Último recurso: erro no próprio layout raiz. Substitui o layout inteiro, por
 * isso traz o seu <html>, <body> e os estilos. As fontes do layout não chegam
 * aqui (o texto usa as fontes do sistema). O "Voltar para o Início" é um link
 * comum, de propósito: recarrega a página inteira e refaz o layout que falhou.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full">
        <title>Erro · DG Brasil</title>
        <StandalonePage>
          <ErrorState
            title="O sistema encontrou um erro."
            description={
              <>
                Tente novamente em instantes. Se o erro continuar, avise o escritório.
                {digest && <span className="mt-1 block text-[12px] text-subtle">Código de referência: {digest.slice(0, 10).toUpperCase()}</span>}
              </>
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => retry()}>
                  Tentar novamente
                </Button>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga completa de propósito */}
                <a href="/" className={buttonClasses("ghost")}>
                  Voltar para o Início
                </a>
              </div>
            }
          />
        </StandalonePage>
      </body>
    </html>
  );
}
