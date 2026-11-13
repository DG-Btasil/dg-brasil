import type { ReactNode } from "react";
import { Wordmark } from "@/components/layout/wordmark";
import { Panel } from "@/components/ui/panel";

/**
 * Moldura das páginas que aparecem SEM o menu: endereço que não existe e erro
 * fora da área autenticada. Só a marca e um painel central. Não busca sessão nem
 * dado nenhum: tem de funcionar mesmo quando o resto do sistema falhou.
 */
export function StandalonePage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-muted">
      <header className="bg-navy px-6 py-4 sm:px-10">
        <Wordmark tone="light" />
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <Panel className="w-full max-w-[520px]">{children}</Panel>
      </main>
    </div>
  );
}
