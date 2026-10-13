"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { referenceCode, type ActionError } from "@/lib/actions/result";
import { ErrorState } from "./states";

/**
 * Erro de uma leitura real (Server Action / Server Component). Mostra só a
 * mensagem segura do servidor — nunca Postgres, RLS, tabela ou stack — e o
 * código de referência, que liga a tela ao log do servidor (requestId).
 * Sem `onRetry`, "Tentar novamente" recarrega os dados do servidor da rota.
 */
export function ActionErrorState({ error, onRetry, title }: { error: ActionError; onRetry?: () => void; title?: string }) {
  const router = useRouter();
  const code = referenceCode(error.requestId);
  return (
    <ErrorState
      title={title}
      description={
        <>
          {error.error.message}
          {code && <span className="mt-1 block text-[12px] text-subtle">Código de referência: {code}</span>}
        </>
      }
      action={
        <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={onRetry ?? (() => router.refresh())}>
          Tentar novamente
        </Button>
      }
    />
  );
}
