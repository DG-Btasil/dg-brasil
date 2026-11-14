"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * Endereço interno do clique que deve ser interceptado, ou null quando o
 * clique segue normal: botão que não é o esquerdo, tecla de modificador (nova
 * aba), link para fora, download, outra janela ou só uma âncora na mesma
 * página. Puro e testado (unsaved-changes.test.ts).
 */
export function interceptedHref(
  click: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean },
  link: { href: string; target?: string; download?: boolean } | null,
  current: { origin: string; pathname: string; search: string },
): string | null {
  if (!link || click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (link.download || (link.target && link.target !== "_self")) return null;
  let url: URL;
  try {
    url = new URL(link.href, `${current.origin}${current.pathname}${current.search}`);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Enquanto `dirty`, sair da tela pergunta antes. Fechar ou recarregar a aba
 * usa o aviso do próprio navegador (é o único que o navegador permite nessa
 * hora). Clicar num link interno (menu, migalhas, qualquer <Link>) abre o
 * diálogo do sistema: o Next 16 não tem um bloqueio de navegação geral, então
 * o clique é interceptado antes do Link e a navegação só acontece se a pessoa
 * escolher sair. Voltar pelo botão do navegador não é interceptado.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Navegadores antigos só mostram o aviso com returnValue preenchido.
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const link = anchor instanceof HTMLAnchorElement ? { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") } : null;
      const href = interceptedHref(e, link, window.location);
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Fase de captura no document: chega antes do onClick do <Link> (que fica na raiz do React).
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  return {
    pendingHref,
    stay: () => setPendingHref(null),
    leave: () => {
      const href = pendingHref;
      setPendingHref(null);
      if (href) router.push(href);
    },
  };
}

/** Diálogo do "sair sem salvar", ligado ao `useUnsavedChangesGuard`. */
export function UnsavedChangesDialog({ guard, description }: { guard: ReturnType<typeof useUnsavedChangesGuard>; description: string }) {
  if (!guard.pendingHref) return null;
  return (
    <Dialog
      open
      size="sm"
      onOpenChange={(o) => !o && guard.stay()}
      title="Sair sem salvar?"
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={guard.stay}>
            Continuar editando
          </Button>
          <Button variant="danger" onClick={guard.leave}>
            Sair sem salvar
          </Button>
        </>
      }
    />
  );
}
